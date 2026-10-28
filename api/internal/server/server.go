// Package server monta o roteador Gin da API.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gsmunizz/prumoweb/api/internal/config"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

type Server struct {
	cfg config.Config
	log *slog.Logger
	// app conecta como prumo_app (dados, com RLS); auth como prumo_auth (PER-04, PER-07).
	app  *pgxpool.Pool
	auth *pgxpool.Pool
}

func New(cfg config.Config, log *slog.Logger, app, auth *pgxpool.Pool) *Server {
	return &Server{cfg: cfg, log: log, app: app, auth: auth}
}

// Handler devolve o roteador. As rotas ficam sob /api/v1, o mesmo caminho que o
// navegador usa: o host do frontend repassa /api/* sem reescrever o caminho.
func (s *Server) Handler() http.Handler {
	if s.cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.HandleMethodNotAllowed = true
	// Nenhum proxy é confiável por enquanto: c.ClientIP() usa o IP da conexão.
	// O cabeçalho de IP do host entra junto com os limites de taxa (AUT-11).
	_ = r.SetTrustedProxies(nil)

	r.Use(
		httpx.RequestIDMiddleware(),
		httpx.LoggerMiddleware(s.log),
		httpx.Recovery(s.log),
		httpx.SecurityHeaders(s.cfg.IsProduction()),
		httpx.BodyLimit(1<<20), // 1 MB; o sync/push terá 5 MB
	)
	r.NoRoute(func(c *gin.Context) { httpx.Abort(c, httpx.ErrNotFound) })
	r.NoMethod(func(c *gin.Context) {
		httpx.Abort(c, httpx.NewError(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "método não permitido"))
	})

	v1 := r.Group("/api/v1")
	v1.GET("/health", s.health)

	return r
}

type healthResponse struct {
	Status  string `json:"status"`
	Version string `json:"version"`
	DB      string `json:"db"`
}

// GET /v1/health: 200 com o banco no ar, 503 se ele não responde.
func (s *Server) health(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()

	if _, err := store.New(s.app).Ping(ctx); err != nil {
		s.log.Warn("health: banco indisponível", "request_id", httpx.RequestID(c))
		c.JSON(http.StatusServiceUnavailable, healthResponse{Status: "degraded", Version: s.cfg.Version, DB: "down"})
		return
	}
	c.JSON(http.StatusOK, healthResponse{Status: "ok", Version: s.cfg.Version, DB: "ok"})
}

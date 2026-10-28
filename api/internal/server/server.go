// Package server monta o roteador Gin da API.
package server

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
	"github.com/gsmunizz/prumoweb/api/internal/config"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/mail"
	"github.com/gsmunizz/prumoweb/api/internal/store"
	"github.com/gsmunizz/prumoweb/api/internal/syncer"
)

type Server struct {
	cfg config.Config
	log *slog.Logger
	// app conecta como prumo_app (dados, com RLS); auth como prumo_auth (PER-04, PER-07).
	app    *pgxpool.Pool
	signer *auth.Signer
	auth   *auth.Service
	sync   *syncer.Service
	pushes *pushLimiter
	now    func() time.Time
}

func New(cfg config.Config, log *slog.Logger, app, authPool *pgxpool.Pool) (*Server, error) {
	signer, err := newSigner(cfg, log)
	if err != nil {
		return nil, err
	}
	var sender mail.Sender = mail.Log{Logger: log}
	if cfg.ResendAPIKey != "" {
		sender = &mail.Resend{APIKey: cfg.ResendAPIKey, From: cfg.MailFrom}
	}
	svc, err := auth.NewService(authPool, signer, auth.Options{
		RegistrationMode: cfg.RegistrationMode, AllowedEmails: cfg.AllowedEmails,
		AppOrigin: cfg.AppOrigin, Mail: sender,
	})
	if err != nil {
		return nil, err
	}
	svc.SetGoogle(auth.GoogleConfig{
		ClientID: cfg.GoogleClientID, ClientSecret: cfg.GoogleClientSecret, RedirectURL: cfg.GoogleRedirectURL,
	})
	return &Server{
		cfg: cfg, log: log, app: app, signer: signer, auth: svc, now: time.Now,
		sync: syncer.New(app), pushes: newPushLimiter(syncPushesPerMinute),
	}, nil
}

// SetMailer troca o remetente de e-mails; existe para os testes.
func (s *Server) SetMailer(m mail.Sender) { s.auth.SetMailer(m) }

// Wait espera os e-mails em andamento; chamado no encerramento da API.
func (s *Server) Wait() { s.auth.Wait() }

// SetClock troca o relógio da API e do serviço de autenticação; existe para os testes.
func (s *Server) SetClock(now func() time.Time) {
	s.now = now
	s.auth.SetClock(now)
	s.sync.SetClock(now)
}

func newSigner(cfg config.Config, log *slog.Logger) (*auth.Signer, error) {
	key := cfg.AuthSigningKey
	if key == "" {
		// Só chega aqui em desenvolvimento (config.Load exige a chave em produção).
		generated, err := auth.GenerateSeed()
		if err != nil {
			return nil, err
		}
		key = generated
		log.Warn("AUTH_SIGNING_KEY ausente: usando chave temporária, os tokens morrem a cada reinício")
	}
	seed, err := base64.StdEncoding.DecodeString(key)
	if err != nil {
		return nil, fmt.Errorf("AUTH_SIGNING_KEY não é base64: %w", err)
	}
	previous, err := auth.ParsePreviousKeys(cfg.AuthPreviousKeys)
	if err != nil {
		return nil, err
	}
	kid := cfg.AuthSigningKeyID
	if kid == "" {
		kid = "k1"
	}
	return auth.NewSigner(kid, seed, previous)
}

// Handler devolve o roteador. As rotas ficam sob /api/v1, o mesmo caminho que o
// navegador usa: o host do frontend repassa /api/* sem reescrever o caminho.
func (s *Server) Handler() http.Handler {
	if s.cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.HandleMethodNotAllowed = true
	// Sem TRUSTED_PROXIES, c.ClientIP() usa o IP da conexão (nil desliga a confiança em X-Forwarded-For).
	if len(s.cfg.TrustedProxies) == 0 {
		_ = r.SetTrustedProxies(nil)
	} else if err := r.SetTrustedProxies(s.cfg.TrustedProxies); err != nil {
		s.log.Error("TRUSTED_PROXIES inválida", "error", err)
		_ = r.SetTrustedProxies(nil)
	}

	r.Use(
		httpx.RequestIDMiddleware(),
		httpx.LoggerMiddleware(s.log),
		httpx.Recovery(s.log),
		httpx.SecurityHeaders(s.cfg.IsProduction()),
		s.bodyLimit,
	)
	r.NoRoute(func(c *gin.Context) { httpx.Abort(c, httpx.ErrNotFound) })
	r.NoMethod(func(c *gin.Context) {
		httpx.Abort(c, httpx.NewError(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "método não permitido"))
	})

	v1 := r.Group("/api/v1")
	v1.GET("/health", s.health)
	s.registerAuthRoutes(v1)
	s.registerSyncRoutes(v1)

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

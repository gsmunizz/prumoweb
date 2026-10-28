package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"time"

	"github.com/gin-gonic/gin"
)

const requestIDKey = "request_id"

var validRequestID = regexp.MustCompile(`^[A-Za-z0-9-]{8,64}$`)

// RequestIDMiddleware repete o X-Request-Id do cliente, se for válido, ou gera um.
func RequestIDMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-Id")
		if !validRequestID.MatchString(id) {
			var b [16]byte
			_, _ = rand.Read(b[:])
			id = hex.EncodeToString(b[:])
		}
		c.Set(requestIDKey, id)
		c.Header("X-Request-Id", id)
		c.Next()
	}
}

func RequestID(c *gin.Context) string { return c.GetString(requestIDKey) }

// UserIDKey é onde o middleware de autenticação guarda o user_id (PER-01).
const UserIDKey = "user_id"

// LoggerMiddleware registra só request_id, user_id, rota, status e duração (PER-09).
// Corpo, query string, cabeçalhos e cookies nunca entram no log.
func LoggerMiddleware(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()

		route := c.FullPath()
		if route == "" {
			route = "não encontrada"
		}
		attrs := []any{
			"request_id", RequestID(c),
			"method", c.Request.Method,
			"route", route,
			"status", c.Writer.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
		}
		if uid := c.GetString(UserIDKey); uid != "" {
			attrs = append(attrs, "user_id", uid)
		}
		level := slog.LevelInfo
		if c.Writer.Status() >= 500 {
			level = slog.LevelError
			for _, e := range c.Errors {
				// Só o tipo do erro: a mensagem pode carregar dados do usuário.
				attrs = append(attrs, "error_type", fmt.Sprintf("%T", e.Err))
			}
		}
		log.Log(c.Request.Context(), level, "request", attrs...)
	}
}

// Recovery transforma um panic em INTERNAL no formato padrão.
func Recovery(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Error("panic", "request_id", RequestID(c), "route", c.FullPath())
				Abort(c, ErrInternal)
			}
		}()
		c.Next()
	}
}

// SecurityHeaders aplica os cabeçalhos de segurança a toda resposta da API.
func SecurityHeaders(production bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Cache-Control", "no-store")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		if production {
			h.Set("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
		}
		c.Next()
	}
}

// BodyLimit recusa corpos maiores que max bytes com PAYLOAD_TOO_LARGE.
func BodyLimit(max int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > max {
			Abort(c, ErrTooLarge)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max)
		c.Next()
	}
}

package server

import (
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
)

const (
	ctxUserID    = httpx.UserIDKey
	ctxSessionID = "session_id"
)

var (
	errUnauthenticated = httpx.NewError(http.StatusUnauthorized, "UNAUTHENTICATED", "sem token ou token inválido")
	errTokenExpired    = httpx.NewError(http.StatusUnauthorized, "TOKEN_EXPIRED", "token de acesso vencido")
	errCSRF            = httpx.NewError(http.StatusForbidden, "CSRF_REJECTED", "origem ou cabeçalho do cliente inválidos")
)

// requireAuth exige o token de acesso e coloca user_id e session_id no contexto (PER-01).
// Com live, confere também no banco se a sessão segue ativa, para rotas sensíveis (AUT-20).
func (s *Server) requireAuth(live bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := strings.CutPrefix(c.GetHeader("Authorization"), "Bearer ")
		if !ok || token == "" {
			httpx.Abort(c, errUnauthenticated)
			return
		}
		claims, err := s.signer.Parse(token, s.now())
		if err != nil {
			if errors.Is(err, auth.ErrTokenExpired) {
				httpx.Abort(c, errTokenExpired)
				return
			}
			httpx.Abort(c, errUnauthenticated)
			return
		}
		userID, _ := claims.UserID()
		if live {
			ok, err := s.auth.SessionIsLive(c.Request.Context(), userID, claims.SessionID)
			if err != nil {
				httpx.Abort(c, err)
				return
			}
			if !ok {
				httpx.Abort(c, auth.ErrSessionRevoked)
				return
			}
		}
		c.Set(ctxUserID, userID.String())
		c.Set(ctxSessionID, claims.SessionID.String())
		c.Next()
	}
}

// requireSameOrigin protege as rotas que mexem no cookie de sessão contra CSRF (AUT-17):
// o Origin tem de ser o do app e o cabeçalho X-Prumo-Client tem de estar presente.
func (s *Server) requireSameOrigin() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("Origin") != s.cfg.AppOrigin || c.GetHeader("X-Prumo-Client") != "web" {
			httpx.Abort(c, errCSRF)
			return
		}
		c.Next()
	}
}

func userID(c *gin.Context) uuid.UUID {
	id, _ := uuid.Parse(c.GetString(ctxUserID))
	return id
}

func sessionID(c *gin.Context) uuid.UUID {
	id, _ := uuid.Parse(c.GetString(ctxSessionID))
	return id
}

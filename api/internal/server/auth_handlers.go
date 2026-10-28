package server

import (
	"errors"
	"net/http"
	"net/netip"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
	"github.com/gsmunizz/prumoweb/api/internal/database"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

const (
	refreshCookie = "prumo_rt"
	refreshPath   = "/api/v1/auth"
)

type userDTO struct {
	ID            uuid.UUID `json:"id"`
	Email         string    `json:"email"`
	EmailVerified bool      `json:"email_verified"`
}

func toUserDTO(u store.User) userDTO {
	return userDTO{ID: u.ID, Email: u.Email, EmailVerified: u.EmailVerifiedAt.Valid}
}

type sessionResponse struct {
	User        userDTO `json:"user"`
	AccessToken string  `json:"access_token"`
	ExpiresIn   int     `json:"expires_in"`
}

func (s *Server) registerAuthRoutes(v1 *gin.RouterGroup) {
	g := v1.Group("/auth", s.requireSameOrigin())
	g.POST("/register", s.register)
	g.POST("/login", s.login)
	g.POST("/refresh", s.refresh)
	g.POST("/logout", s.logout)

	sessions := g.Group("/sessions", s.requireAuth(true))
	sessions.GET("", s.listSessions)
	sessions.DELETE("", s.revokeOtherSessions)
	sessions.DELETE("/:id", s.revokeSession)

	v1.GET("/me", s.requireAuth(false), s.me)
}

func clientInfo(c *gin.Context) auth.ClientInfo {
	info := auth.ClientInfo{UserAgent: c.Request.UserAgent()}
	if ip, err := netip.ParseAddr(c.ClientIP()); err == nil {
		info.IP = ip.Unmap()
	}
	return info
}

func (s *Server) setRefreshCookie(c *gin.Context, token string, expires time.Time) {
	maxAge := int(time.Until(expires).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	s.writeCookie(c, token, maxAge)
}

func (s *Server) clearRefreshCookie(c *gin.Context) { s.writeCookie(c, "", -1) }

func (s *Server) writeCookie(c *gin.Context, value string, maxAge int) {
	// Secure acompanha o HTTPS do app; em http://localhost (desenvolvimento) o Safari recusaria o cookie.
	http.SetCookie(c.Writer, &http.Cookie{ //nolint:gosec // Secure é dinâmico por ambiente, veja cookieSecure
		Name: refreshCookie, Value: value, Path: refreshPath, MaxAge: maxAge,
		HttpOnly: true, Secure: s.cookieSecure(), SameSite: http.SameSiteStrictMode, // AUT-13
	})
}

// cookieSecure liga o atributo Secure sempre que o app é servido por HTTPS.
func (s *Server) cookieSecure() bool {
	return s.cfg.IsProduction() || len(s.cfg.AppOrigin) >= 8 && s.cfg.AppOrigin[:8] == "https://"
}

// fail responde com o erro e, para o limite de taxa, o cabeçalho Retry-After.
func (s *Server) fail(c *gin.Context, err error) {
	var rl *auth.RateLimitError
	if errors.As(err, &rl) {
		c.Header("Retry-After", strconv.Itoa(int(rl.RetryAfter.Seconds())))
	}
	httpx.Abort(c, err)
}

func bind(c *gin.Context, dst any) bool {
	if err := c.ShouldBindJSON(dst); err != nil {
		httpx.Abort(c, httpx.NewError(http.StatusBadRequest, "BAD_REQUEST", "JSON malformado"))
		return false
	}
	return true
}

func (s *Server) respondSession(c *gin.Context, status int, t auth.Tokens) {
	s.setRefreshCookie(c, t.RefreshToken, t.RefreshExpires)
	c.JSON(status, sessionResponse{User: toUserDTO(t.User), AccessToken: t.AccessToken, ExpiresIn: int(t.ExpiresIn.Seconds())})
}

func (s *Server) register(c *gin.Context) {
	var in struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		Name        string `json:"name"`
		AcceptTerms bool   `json:"accept_terms"`
	}
	if !bind(c, &in) {
		return
	}
	t, err := s.auth.Register(c.Request.Context(), auth.RegisterInput{
		Email: in.Email, Password: in.Password, Name: in.Name, AcceptTerms: in.AcceptTerms,
	}, clientInfo(c))
	if err != nil {
		s.fail(c, err)
		return
	}
	s.respondSession(c, http.StatusCreated, t)
}

func (s *Server) login(c *gin.Context) {
	var in struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !bind(c, &in) {
		return
	}
	t, err := s.auth.Login(c.Request.Context(), in.Email, in.Password, clientInfo(c))
	if err != nil {
		s.fail(c, err)
		return
	}
	s.respondSession(c, http.StatusOK, t)
}

func (s *Server) refresh(c *gin.Context) {
	token, _ := c.Cookie(refreshCookie)
	t, err := s.auth.Refresh(c.Request.Context(), token, clientInfo(c))
	if err != nil {
		if errors.Is(err, auth.ErrRefreshInvalid) || errors.Is(err, auth.ErrSessionRevoked) {
			s.clearRefreshCookie(c)
		}
		s.fail(c, err)
		return
	}
	if t.RefreshToken != "" {
		s.setRefreshCookie(c, t.RefreshToken, t.RefreshExpires)
	}
	c.JSON(http.StatusOK, gin.H{"access_token": t.AccessToken, "expires_in": int(t.ExpiresIn.Seconds())})
}

func (s *Server) logout(c *gin.Context) {
	token, _ := c.Cookie(refreshCookie)
	if err := s.auth.Logout(c.Request.Context(), token, clientInfo(c)); err != nil {
		s.fail(c, err)
		return
	}
	s.clearRefreshCookie(c)
	c.Status(http.StatusNoContent)
}

func (s *Server) listSessions(c *gin.Context) {
	sessions, err := s.auth.ListSessions(c.Request.Context(), userID(c))
	if err != nil {
		s.fail(c, err)
		return
	}
	current := sessionID(c)
	data := make([]gin.H, 0, len(sessions))
	for _, sess := range sessions {
		data = append(data, gin.H{
			"id": sess.ID, "device": sess.Device.String,
			"created_at": formatInstant(sess.CreatedAt.Time), "last_used_at": formatInstant(sess.LastUsedAt.Time),
			"current": sess.ID == current,
		})
	}
	c.JSON(http.StatusOK, gin.H{"data": data})
}

func (s *Server) revokeSession(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		httpx.Abort(c, httpx.ErrNotFound)
		return
	}
	if err := s.auth.RevokeSession(c.Request.Context(), userID(c), id, clientInfo(c)); err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) revokeOtherSessions(c *gin.Context) {
	if err := s.auth.RevokeOtherSessions(c.Request.Context(), userID(c), sessionID(c), clientInfo(c)); err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

type profileDTO struct {
	Name     string `json:"name"`
	Currency string `json:"currency"`
	Timezone string `json:"timezone"`
	Theme    string `json:"theme"`
}

func (s *Server) me(c *gin.Context) {
	ctx := c.Request.Context()
	uid := userID(c)

	user, err := s.auth.GetUser(ctx, uid)
	if err != nil {
		s.fail(c, err)
		return
	}
	var profile store.Profile
	// O perfil é dado financeiro-adjacente: lido pelo papel prumo_app, sob RLS (PER-04).
	err = database.WithUser(ctx, s.app, uid, func(tx pgx.Tx) error {
		var err error
		profile, err = store.New(tx).GetProfile(ctx, uid)
		return err
	})
	if err != nil {
		s.fail(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"id": user.ID, "email": user.Email, "email_verified": user.EmailVerifiedAt.Valid,
		"has_password": user.PasswordHash.Valid, "google_linked": false,
		"profile": profileDTO{Name: profile.Name, Currency: profile.Currency, Timezone: profile.Timezone, Theme: profile.Theme},
	})
}

// formatInstant: RFC 3339 em UTC com milissegundos, como em toda a API.
func formatInstant(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

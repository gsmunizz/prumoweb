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
	g.POST("/verify-email", s.verifyEmail)
	g.POST("/verify-email/resend", s.requireAuth(true), s.resendVerification)
	g.POST("/password/forgot", s.forgotPassword)
	g.POST("/password/reset", s.resetPassword)
	g.POST("/reauth", s.requireAuth(true), s.reauth)
	// O Google chega por navegação (GET), sem os cabeçalhos do app: ficam fora do requireSameOrigin
	// do grupo. O state assinado no cookie prumo_oidc faz o papel de anti-CSRF (AUT-21).
	v1.GET("/auth/google/start", s.googleStart)
	v1.GET("/auth/google/callback", s.googleCallback)

	sessions := g.Group("/sessions", s.requireAuth(true))
	sessions.GET("", s.listSessions)
	sessions.DELETE("", s.revokeOtherSessions)
	sessions.DELETE("/:id", s.revokeSession)

	v1.GET("/me", s.requireAuth(false), s.me)
	v1.PUT("/me/password", s.requireAuth(true), s.changePassword)
	v1.POST("/me/email", s.requireAuth(true), s.requestEmailChange)
	v1.POST("/me/email/confirm", s.confirmEmailChange)
	v1.DELETE("/me/google", s.requireAuth(true), s.unlinkGoogle)
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
	linked, err := s.auth.GoogleLinked(ctx, uid)
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
		"has_password": user.PasswordHash.Valid, "google_linked": linked,
		"profile": profileDTO{Name: profile.Name, Currency: profile.Currency, Timezone: profile.Timezone, Theme: profile.Theme},
	})
}

// formatInstant: RFC 3339 em UTC com milissegundos, como em toda a API.
func formatInstant(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func noContent(s *Server, c *gin.Context, err error) {
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (s *Server) verifyEmail(c *gin.Context) {
	var in struct {
		Token string `json:"token"`
	}
	if !bind(c, &in) {
		return
	}
	noContent(s, c, s.auth.VerifyEmail(c.Request.Context(), in.Token, clientInfo(c)))
}

func (s *Server) resendVerification(c *gin.Context) {
	err := s.auth.ResendVerification(c.Request.Context(), userID(c), clientInfo(c))
	if err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusAccepted)
}

func (s *Server) forgotPassword(c *gin.Context) {
	var in struct {
		Email string `json:"email"`
	}
	if !bind(c, &in) {
		return
	}
	if err := s.auth.ForgotPassword(c.Request.Context(), in.Email, clientInfo(c)); err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusAccepted) // sempre 202 (AUT-25)
}

func (s *Server) resetPassword(c *gin.Context) {
	var in struct {
		Token       string `json:"token"`
		NewPassword string `json:"new_password"`
	}
	if !bind(c, &in) {
		return
	}
	noContent(s, c, s.auth.ResetPassword(c.Request.Context(), in.Token, in.NewPassword, clientInfo(c)))
}

func (s *Server) reauth(c *gin.Context) {
	var in struct {
		Password string `json:"password"`
	}
	if !bind(c, &in) {
		return
	}
	noContent(s, c, s.auth.Reauth(c.Request.Context(), userID(c), sessionID(c), in.Password, clientInfo(c)))
}

func (s *Server) changePassword(c *gin.Context) {
	var in struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if !bind(c, &in) {
		return
	}
	noContent(s, c, s.auth.ChangePassword(c.Request.Context(), userID(c), sessionID(c), in.CurrentPassword, in.NewPassword, clientInfo(c)))
}

func (s *Server) requestEmailChange(c *gin.Context) {
	var in struct {
		NewEmail string `json:"new_email"`
	}
	if !bind(c, &in) {
		return
	}
	if err := s.auth.RequestEmailChange(c.Request.Context(), userID(c), sessionID(c), in.NewEmail, clientInfo(c)); err != nil {
		s.fail(c, err)
		return
	}
	c.Status(http.StatusAccepted)
}

func (s *Server) confirmEmailChange(c *gin.Context) {
	var in struct {
		Token string `json:"token"`
	}
	if !bind(c, &in) {
		return
	}
	noContent(s, c, s.auth.ConfirmEmailChange(c.Request.Context(), in.Token, clientInfo(c)))
}

const oidcCookie = "prumo_oidc"

// writeOIDCCookie grava (ou, com maxAge negativo, apaga) o cookie do fluxo do Google. É Lax e
// não Strict porque precisa voltar na navegação que vem do Google (AUT-21).
func (s *Server) writeOIDCCookie(c *gin.Context, value string, maxAge int) {
	http.SetCookie(c.Writer, &http.Cookie{ //nolint:gosec // Secure é dinâmico por ambiente, veja cookieSecure
		Name: oidcCookie, Value: value, Path: "/api/v1/auth/google", MaxAge: maxAge,
		HttpOnly: true, Secure: s.cookieSecure(), SameSite: http.SameSiteLaxMode,
	})
}

func (s *Server) googleStart(c *gin.Context) {
	refresh, _ := c.Cookie(refreshCookie)
	intent := c.Query("intent")
	authURL, cookie, err := s.auth.GoogleStart(c.Request.Context(), intent, refresh)
	if err != nil {
		var apiErr *httpx.Error
		switch {
		case errors.Is(err, auth.ErrRefreshInvalid), errors.Is(err, auth.ErrSessionRevoked):
			// Vincular e reautenticar pedem sessão; é navegação, então o erro volta ao app em ?error=.
			c.Redirect(http.StatusFound, s.auth.CallbackURL(intent, "UNAUTHENTICATED"))
		case errors.As(err, &apiErr):
			s.fail(c, err)
		default:
			s.log.Error("google start", "error", err, "request_id", httpx.RequestID(c))
			c.Redirect(http.StatusFound, s.auth.CallbackURL(intent, auth.ErrOIDCFailed.Code))
		}
		return
	}
	s.writeOIDCCookie(c, cookie, int(10*time.Minute/time.Second))
	c.Redirect(http.StatusFound, authURL)
}

func (s *Server) googleCallback(c *gin.Context) {
	cookie, _ := c.Cookie(oidcCookie)
	s.writeOIDCCookie(c, "", -1) // uso único
	if c.Query("error") != "" {  // o usuário recusou no Google
		c.Redirect(http.StatusFound, s.auth.CallbackURL("", auth.ErrOIDCFailed.Code))
		return
	}
	res, err := s.auth.GoogleCallback(c.Request.Context(), cookie, c.Query("state"), c.Query("code"), clientInfo(c))
	if err != nil {
		code := auth.ErrOIDCFailed.Code
		var apiErr *httpx.Error
		if errors.As(err, &apiErr) {
			code = apiErr.Code
		} else {
			s.log.Error("google callback", "error", err, "request_id", httpx.RequestID(c))
		}
		c.Redirect(http.StatusFound, s.auth.CallbackURL(res.Intent, code))
		return
	}
	if res.Intent == auth.IntentLogin {
		s.setRefreshCookie(c, res.Tokens.RefreshToken, res.Tokens.RefreshExpires)
	}
	c.Redirect(http.StatusFound, s.auth.CallbackURL(res.Intent, ""))
}

func (s *Server) unlinkGoogle(c *gin.Context) {
	noContent(s, c, s.auth.UnlinkGoogle(c.Request.Context(), userID(c), clientInfo(c)))
}

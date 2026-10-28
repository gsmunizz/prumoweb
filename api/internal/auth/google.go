package auth

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/oauth2"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

const (
	GoogleIssuer = "https://accounts.google.com"

	oidcCookieTTL  = 10 * time.Minute // AUT-21
	googleTimeout  = 10 * time.Second
	providerGoogle = "google"
)

// Intenções do fluxo: entrar, vincular o Google à conta logada ou reautenticar (AUT-21, AUT-30).
const (
	IntentLogin  = "login"
	IntentLink   = "link"
	IntentReauth = "reauth"
)

// Erros do retorno do Google. O callback os devolve ao app em ?error=<code>.
var (
	ErrOIDCFailed         = httpx.NewError(400, "OIDC_FAILED", "falha no login com o Google")
	ErrGoogleEmailUnver   = httpx.NewError(403, "EMAIL_NOT_VERIFIED", "o Google não confirmou este e-mail")
	ErrAccountLinkNeeded  = httpx.NewError(409, "ACCOUNT_LINK_REQUIRED", "entre com a senha e vincule o Google nas configurações")
	ErrGoogleAlreadyUsed  = httpx.NewError(409, "GOOGLE_ALREADY_LINKED", "esta conta Google já está vinculada a outro usuário")
	ErrLastLoginMethod    = httpx.NewError(409, "LAST_LOGIN_METHOD", "defina uma senha antes de desvincular o Google")
	ErrGoogleNotConfigure = httpx.NewError(404, "NOT_FOUND", "recurso não encontrado")
)

// GoogleConfig liga o login com Google. Issuer vazio usa o do Google; os testes apontam
// para um provedor falso.
type GoogleConfig struct {
	ClientID     string
	ClientSecret string
	RedirectURL  string
	Issuer       string
}

type google struct {
	cfg GoogleConfig

	mu       sync.Mutex
	oauth    *oauth2.Config
	verifier *oidc.IDTokenVerifier
}

func httpCtx(ctx context.Context) context.Context {
	return oidc.ClientContext(ctx, &http.Client{Timeout: googleTimeout})
}

// ready faz a descoberta do provedor na primeira chamada e tenta de novo se ela falhar.
func (g *google) ready(ctx context.Context) (*oauth2.Config, *oidc.IDTokenVerifier, error) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.oauth != nil {
		return g.oauth, g.verifier, nil
	}
	issuer := g.cfg.Issuer
	if issuer == "" {
		issuer = GoogleIssuer
	}
	provider, err := oidc.NewProvider(httpCtx(ctx), issuer)
	if err != nil {
		return nil, nil, err
	}
	g.oauth = &oauth2.Config{
		ClientID: g.cfg.ClientID, ClientSecret: g.cfg.ClientSecret, RedirectURL: g.cfg.RedirectURL,
		Endpoint: provider.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
	}
	g.verifier = provider.Verifier(&oidc.Config{ClientID: g.cfg.ClientID})
	return g.oauth, g.verifier, nil
}

// SetGoogle liga (ou, com ClientID vazio, desliga) o login com Google.
func (s *Service) SetGoogle(cfg GoogleConfig) {
	if cfg.ClientID == "" {
		s.google = nil
		return
	}
	s.google = &google{cfg: cfg}
}

// GoogleEnabled diz se o login com Google está configurado.
func (s *Service) GoogleEnabled() bool { return s.google != nil }

// oidcState é o que o cookie prumo_oidc carrega entre o início e o retorno do Google.
type oidcState struct {
	State     string    `json:"s"`
	Verifier  string    `json:"v"` // PKCE
	Nonce     string    `json:"n"`
	Intent    string    `json:"i"`
	SessionID uuid.UUID `json:"sid"` // sessão de quem vincula ou reautentica
	Expires   int64     `json:"e"`
}

func (s *Service) signOIDC(st oidcState) (string, error) {
	raw, err := json.Marshal(st)
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(raw)
	mac := hmac.New(sha256.New, s.signer.DeriveKey("oidc-cookie"))
	mac.Write([]byte(body))
	return body + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) openOIDC(value string) (oidcState, error) {
	body, sig, ok := strings.Cut(value, ".")
	if !ok {
		return oidcState{}, ErrOIDCFailed
	}
	got, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return oidcState{}, ErrOIDCFailed
	}
	mac := hmac.New(sha256.New, s.signer.DeriveKey("oidc-cookie"))
	mac.Write([]byte(body))
	if !hmac.Equal(got, mac.Sum(nil)) {
		return oidcState{}, ErrOIDCFailed
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return oidcState{}, ErrOIDCFailed
	}
	var st oidcState
	if err := json.Unmarshal(raw, &st); err != nil || s.now().Unix() > st.Expires {
		return oidcState{}, ErrOIDCFailed
	}
	return st, nil
}

func randomString() (string, error) {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// GoogleStart monta a URL de autorização (code + PKCE + state + nonce, AUT-21) e o valor do
// cookie prumo_oidc. Para vincular ou reautenticar, a sessão vem do refresh token do cookie.
func (s *Service) GoogleStart(ctx context.Context, intent, refreshToken string) (authURL, cookie string, err error) {
	if s.google == nil {
		return "", "", ErrGoogleNotConfigure
	}
	if intent == "" {
		intent = IntentLogin
	}
	st := oidcState{Intent: intent, Expires: s.now().Add(oidcCookieTTL).Unix()}
	switch intent {
	case IntentLogin:
	case IntentLink, IntentReauth:
		sess, err := s.sessionFromRefresh(ctx, refreshToken)
		if err != nil {
			return "", "", err
		}
		st.SessionID = sess.ID
	default:
		return "", "", httpx.ValidationFailed(httpx.FieldError{Field: "intent", Reason: "INVALID_VALUE"})
	}

	oc, _, err := s.google.ready(ctx)
	if err != nil {
		return "", "", err
	}
	if st.State, err = randomString(); err != nil {
		return "", "", err
	}
	if st.Nonce, err = randomString(); err != nil {
		return "", "", err
	}
	st.Verifier = oauth2.GenerateVerifier()

	opts := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(st.Verifier), oidc.Nonce(st.Nonce)}
	if intent != IntentLogin {
		// Pede ao Google um login recente: o reauth só vale com a conta confirmada agora.
		opts = append(opts, oauth2.SetAuthURLParam("prompt", "select_account"), oauth2.SetAuthURLParam("max_age", "0"))
	}
	cookie, err = s.signOIDC(st)
	if err != nil {
		return "", "", err
	}
	return oc.AuthCodeURL(st.State, opts...), cookie, nil
}

// sessionFromRefresh acha a sessão viva do refresh token, sem girar o token.
func (s *Service) sessionFromRefresh(ctx context.Context, refreshToken string) (store.Session, error) {
	if refreshToken == "" {
		return store.Session{}, ErrRefreshInvalid
	}
	sess, err := store.New(s.db).GetSessionByRefreshHash(ctx, HashRefreshToken(refreshToken))
	if errors.Is(err, pgx.ErrNoRows) {
		return store.Session{}, ErrRefreshInvalid
	}
	if err != nil {
		return store.Session{}, err
	}
	if !s.sessionAlive(sess, s.now().UTC()) {
		return store.Session{}, ErrSessionRevoked
	}
	return sess, nil
}

// GoogleResult é o desfecho do retorno do Google. Tokens só vem preenchido no login.
type GoogleResult struct {
	Intent string
	Tokens Tokens
}

type googleClaims struct {
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// GoogleCallback conclui o fluxo: confere cookie e state, troca o code (com o verifier PKCE),
// valida o id_token (assinatura, iss, aud, exp e nonce) e age conforme a intenção.
func (s *Service) GoogleCallback(ctx context.Context, cookie, state, code string, client ClientInfo) (GoogleResult, error) {
	if s.google == nil {
		return GoogleResult{}, ErrGoogleNotConfigure
	}
	st, err := s.openOIDC(cookie)
	if err != nil {
		return GoogleResult{}, err
	}
	res := GoogleResult{Intent: st.Intent}
	if code == "" || subtleNotEqual(state, st.State) {
		return res, s.googleFail(ctx, ErrOIDCFailed, client, nil)
	}
	claims, authTime, err := s.exchangeGoogle(ctx, st, code)
	if err != nil {
		return res, s.googleFail(ctx, err, client, nil)
	}
	// AUT-22: só e-mail que o Google confirmou.
	if !claims.EmailVerified {
		return res, s.googleFail(ctx, ErrGoogleEmailUnver, client, nil)
	}
	email, ok := NormalizeEmail(claims.Email)
	if !ok {
		return res, s.googleFail(ctx, ErrOIDCFailed, client, nil)
	}
	claims.Email = email

	switch st.Intent {
	case IntentLogin:
		res.Tokens, err = s.googleLogin(ctx, claims, client)
	case IntentLink:
		err = s.googleLink(ctx, st.SessionID, claims, client)
	case IntentReauth:
		err = s.googleReauth(ctx, st.SessionID, claims, authTime, client)
	default:
		err = ErrOIDCFailed
	}
	if err != nil {
		return res, s.googleFail(ctx, err, client, nil)
	}
	return res, nil
}

func subtleNotEqual(a, b string) bool { return !hmac.Equal([]byte(a), []byte(b)) }

// googleFail registra a falha (sem dados do Google) e devolve o erro para o redirecionamento.
func (s *Service) googleFail(ctx context.Context, err error, client ClientInfo, uid *uuid.UUID) error {
	code := ErrOIDCFailed.Code
	var apiErr *httpx.Error
	if errors.As(err, &apiErr) {
		code = apiErr.Code
	}
	_ = s.logEvent(ctx, store.New(s.db), uid, "google_failed", client, map[string]any{"code": code})
	var out *httpx.Error
	if errors.As(err, &out) {
		return out
	}
	return err // erro interno: o handler registra e redireciona como OIDC_FAILED
}

func (s *Service) exchangeGoogle(ctx context.Context, st oidcState, code string) (googleClaims, time.Time, error) {
	oc, verifier, err := s.google.ready(ctx)
	if err != nil {
		return googleClaims{}, time.Time{}, err
	}
	tok, err := oc.Exchange(httpCtx(ctx), code, oauth2.VerifierOption(st.Verifier))
	if err != nil {
		return googleClaims{}, time.Time{}, ErrOIDCFailed
	}
	raw, _ := tok.Extra("id_token").(string)
	idt, err := verifier.Verify(httpCtx(ctx), raw)
	if err != nil || !hmac.Equal([]byte(idt.Nonce), []byte(st.Nonce)) {
		return googleClaims{}, time.Time{}, ErrOIDCFailed
	}
	var c struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		AuthTime      int64  `json:"auth_time"`
	}
	if err := idt.Claims(&c); err != nil || idt.Subject == "" {
		return googleClaims{}, time.Time{}, ErrOIDCFailed
	}
	var authTime time.Time
	if c.AuthTime > 0 {
		authTime = time.Unix(c.AuthTime, 0)
	}
	return googleClaims{Subject: idt.Subject, Email: c.Email, EmailVerified: c.EmailVerified, Name: c.Name}, authTime, nil
}

// googleLogin entra pela identidade, vincula a uma conta de e-mail igual e já verificado
// (AUT-22) ou cria a conta (AUT-23, sujeita ao AUT-01).
func (s *Service) googleLogin(ctx context.Context, c googleClaims, client ClientInfo) (Tokens, error) {
	var out Tokens
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		var user store.User
		kind := "google_login"

		ident, err := q.GetIdentityBySubject(ctx, store.GetIdentityBySubjectParams{Provider: providerGoogle, Subject: c.Subject})
		switch {
		case err == nil:
			if user, err = q.GetUserByID(ctx, ident.UserID); err != nil {
				return err
			}
		case errors.Is(err, pgx.ErrNoRows):
			existing, uerr := q.GetUserByEmail(ctx, c.Email)
			switch {
			case uerr == nil:
				if !existing.EmailVerifiedAt.Valid {
					return ErrAccountLinkNeeded
				}
				user = existing
				kind = "google_linked_login"
			case errors.Is(uerr, pgx.ErrNoRows):
				if !s.mayRegister(c.Email) {
					return ErrRegistrationClosed
				}
				if user, err = s.createUser(ctx, tx, newUser{Email: c.Email, Name: googleName(c), Verified: true}); err != nil {
					return err
				}
				kind = "google_register"
			default:
				return uerr
			}
			if err := q.CreateIdentity(ctx, store.CreateIdentityParams{UserID: user.ID, Provider: providerGoogle, Subject: c.Subject, Email: c.Email}); err != nil {
				return err
			}
		default:
			return err
		}

		if out, err = s.openSession(ctx, q, user, client); err != nil {
			return err
		}
		return s.logEvent(ctx, q, &user.ID, kind, client, nil)
	})
	if isUniqueViolation(err, "users_email_key") || isUniqueViolation(err, "identities") {
		return Tokens{}, ErrOIDCFailed // corrida com outro cadastro: tentar de novo resolve
	}
	return out, err
}

func googleName(c googleClaims) string {
	name := strings.TrimSpace(c.Name)
	if name == "" {
		name, _, _ = strings.Cut(c.Email, "@")
	}
	if utf8.RuneCountInString(name) > maxNameLen {
		name = string([]rune(name)[:maxNameLen])
	}
	return name
}

// googleLink vincula a conta Google à conta da sessão que iniciou o fluxo.
func (s *Service) googleLink(ctx context.Context, sessID uuid.UUID, c googleClaims, client ClientInfo) error {
	q := store.New(s.db)
	sess, err := q.GetSession(ctx, sessID)
	if err != nil || !s.sessionAlive(sess, s.now().UTC()) {
		return ErrSessionRevoked
	}
	if other, err := q.GetIdentityBySubject(ctx, store.GetIdentityBySubjectParams{Provider: providerGoogle, Subject: c.Subject}); err == nil {
		if other.UserID == sess.UserID {
			return nil // já vinculado a esta conta
		}
		return ErrGoogleAlreadyUsed
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if _, err := q.GetIdentityByUser(ctx, store.GetIdentityByUserParams{UserID: sess.UserID, Provider: providerGoogle}); err == nil {
		return ErrGoogleAlreadyUsed // a conta já tem outro Google vinculado
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	err = q.CreateIdentity(ctx, store.CreateIdentityParams{UserID: sess.UserID, Provider: providerGoogle, Subject: c.Subject, Email: c.Email})
	if isUniqueViolation(err, "identities") {
		return ErrGoogleAlreadyUsed
	}
	if err != nil {
		return err
	}
	return s.logEvent(ctx, q, &sess.UserID, "google_linked", client, nil)
}

// googleReauth marca a sessão como reautenticada se o Google confirmou a identidade vinculada
// a ela agora (AUT-30).
func (s *Service) googleReauth(ctx context.Context, sessID uuid.UUID, c googleClaims, authTime time.Time, client ClientInfo) error {
	q := store.New(s.db)
	sess, err := q.GetSession(ctx, sessID)
	if err != nil || !s.sessionAlive(sess, s.now().UTC()) {
		return ErrSessionRevoked
	}
	ident, err := q.GetIdentityByUser(ctx, store.GetIdentityByUserParams{UserID: sess.UserID, Provider: providerGoogle})
	if err != nil || ident.Subject != c.Subject {
		return ErrOIDCFailed
	}
	if !authTime.IsZero() && s.now().Sub(authTime) > reauthWindow {
		return ErrOIDCFailed
	}
	if err := q.SetSessionReauth(ctx, store.SetSessionReauthParams{ID: sessID, Now: ts(s.now().UTC())}); err != nil {
		return err
	}
	return s.logEvent(ctx, q, &sess.UserID, "reauth", client, map[string]any{"method": "google"})
}

// GoogleLinked diz se a conta tem o Google vinculado.
func (s *Service) GoogleLinked(ctx context.Context, userID uuid.UUID) (bool, error) {
	_, err := store.New(s.db).GetIdentityByUser(ctx, store.GetIdentityByUserParams{UserID: userID, Provider: providerGoogle})
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// UnlinkGoogle desvincula o Google; a conta não pode ficar sem método de login (AUT-24).
func (s *Service) UnlinkGoogle(ctx context.Context, userID uuid.UUID, client ClientInfo) error {
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.PasswordHash.Valid {
		return ErrLastLoginMethod
	}
	q := store.New(s.db)
	n, err := q.DeleteIdentity(ctx, store.DeleteIdentityParams{UserID: userID, Provider: providerGoogle})
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.ErrNotFound
	}
	return s.logEvent(ctx, q, &userID, "google_unlinked", client, nil)
}

// CallbackURL monta o destino do redirecionamento ao app, com o erro quando houver.
func (s *Service) CallbackURL(intent, errCode string) string {
	q := url.Values{}
	if intent != "" {
		q.Set("intent", intent)
	}
	if errCode != "" {
		q.Set("error", errCode)
	}
	u := s.opts.AppOrigin + "/auth/callback"
	if len(q) > 0 {
		u += "?" + q.Encode()
	}
	return u
}

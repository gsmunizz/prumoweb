package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	netmail "net/mail"
	"net/netip"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/mail"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

const (
	SessionIdleTimeout  = 30 * 24 * time.Hour // AUT-14
	SessionMaxLifetime  = 90 * 24 * time.Hour // AUT-14
	RefreshGraceWindow  = 10 * time.Second    // AUT-15
	loginFailuresWindow = 15 * time.Minute    // AUT-11
	loginFailuresLimit  = 5
	ipFailuresWindow    = time.Hour
	ipFailuresLimit     = 30
	maxEmailLen         = 254
	maxNameLen          = 80
)

// Erros de domínio no formato da API. O cliente traduz o code (veja o catálogo de erros).
var (
	ErrRegistrationClosed = httpx.NewError(403, "REGISTRATION_CLOSED", "cadastro fora da lista de convidados")
	ErrEmailTaken         = httpx.NewError(409, "EMAIL_TAKEN", "e-mail já cadastrado")
	ErrWeakPassword       = httpx.NewError(422, "WEAK_PASSWORD", "senha curta ou comum demais")
	ErrInvalidCredentials = httpx.NewError(401, "INVALID_CREDENTIALS", "e-mail ou senha incorretos")
	ErrRefreshInvalid     = httpx.NewError(401, "REFRESH_INVALID", "refresh token ausente, vencido ou reusado")
	ErrSessionRevoked     = httpx.NewError(401, "SESSION_REVOKED", "sessão encerrada")
	ErrRateLimited        = httpx.NewError(429, "RATE_LIMITED", "muitas tentativas")
)

// Options configura o Service.
type Options struct {
	RegistrationMode string   // invite | open | closed (AUT-01)
	AllowedEmails    []string // já em minúsculas
	AppOrigin        string   // base dos links enviados por e-mail
	Mail             mail.Sender
}

// Service implementa os fluxos de autenticação sobre o pool do papel prumo_auth (PER-07).
type Service struct {
	db     *pgxpool.Pool
	signer *Signer
	opts   Options
	now    func() time.Time
	mailWG sync.WaitGroup
	google *google // nil se o login com Google não está configurado
	// dummyHash gasta o mesmo tempo de um login real quando o e-mail não existe (AUT-10).
	dummyHash string
}

// SetMailer troca o remetente de e-mails; existe para os testes lerem as mensagens.
func (s *Service) SetMailer(m mail.Sender) { s.opts.Mail = m }

// SetClock troca o relógio do serviço; existe para os testes avançarem o tempo.
func (s *Service) SetClock(now func() time.Time) { s.now = now }

func NewService(db *pgxpool.Pool, signer *Signer, opts Options) (*Service, error) {
	dummy, err := HashPassword("senha-que-nunca-sera-usada")
	if err != nil {
		return nil, err
	}
	return &Service{db: db, signer: signer, opts: opts, now: time.Now, dummyHash: dummy}, nil
}

// ClientInfo é o que a API sabe do aparelho que chamou, para o log de segurança e a lista de sessões.
type ClientInfo struct {
	IP        netip.Addr // zero se desconhecido
	UserAgent string
}

func (c ClientInfo) ip() *netip.Addr {
	if !c.IP.IsValid() {
		return nil
	}
	return &c.IP
}

// Tokens é o resultado de um cadastro, login ou refresh.
type Tokens struct {
	AccessToken string
	ExpiresIn   time.Duration
	// RefreshToken vem vazio quando a renovação caiu na janela de tolerância (AUT-15):
	// quem rotacionou antes já entregou o novo cookie, e este deve ser mantido.
	RefreshToken   string
	RefreshExpires time.Time
	User           store.User
	SessionID      uuid.UUID
}

type RegisterInput struct {
	Email       string
	Password    string
	Name        string
	AcceptTerms bool
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// NormalizeEmail aplica AUT-02: sem espaços, minúsculas, até 254 caracteres, formato válido.
func NormalizeEmail(raw string) (string, bool) {
	e := strings.ToLower(strings.TrimSpace(raw))
	if e == "" || len(e) > maxEmailLen {
		return "", false
	}
	addr, err := netmail.ParseAddress(e)
	if err != nil || addr.Address != e || !strings.Contains(e[strings.LastIndex(e, "@"):], ".") {
		return "", false
	}
	return e, true
}

// Register cria usuário, perfil, categorias padrão e a conta Carteira numa única transação
// do banco (AUT-06) e abre a primeira sessão.
func (s *Service) Register(ctx context.Context, in RegisterInput, client ClientInfo) (Tokens, error) {
	var fields []httpx.FieldError
	email, ok := NormalizeEmail(in.Email)
	if !ok {
		fields = append(fields, httpx.FieldError{Field: "email", Reason: "INVALID_FORMAT"})
	}
	name := strings.TrimSpace(in.Name)
	switch n := utf8.RuneCountInString(name); {
	case n == 0:
		fields = append(fields, httpx.FieldError{Field: "name", Reason: "REQUIRED"})
	case n > maxNameLen:
		fields = append(fields, httpx.FieldError{Field: "name", Reason: "TOO_LONG"})
	}
	if !in.AcceptTerms {
		fields = append(fields, httpx.FieldError{Field: "accept_terms", Reason: "REQUIRED"})
	}
	if len(fields) > 0 {
		return Tokens{}, httpx.ValidationFailed(fields...)
	}
	if err := ValidatePassword(in.Password); err != nil {
		return Tokens{}, ErrWeakPassword
	}
	if !s.mayRegister(email) {
		return Tokens{}, ErrRegistrationClosed
	}

	hash, err := HashPassword(in.Password)
	if err != nil {
		return Tokens{}, err
	}

	var out Tokens
	var verifyToken string
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		user, err := s.createUser(ctx, tx, newUser{Email: email, Name: name, PasswordHash: hash})
		if err != nil {
			return err
		}
		out, err = s.openSession(ctx, q, user, client)
		if err != nil {
			return err
		}
		if verifyToken, err = s.issueToken(ctx, q, user.ID, purposeVerify, "", verifyTokenTTL); err != nil {
			return err
		}
		return s.logEvent(ctx, q, &user.ID, "register", client, nil)
	})
	if isUniqueViolation(err, "users_email_key") {
		return Tokens{}, ErrEmailTaken
	}
	if err != nil {
		return out, err
	}
	s.sendMail(mail.Verification(email, s.link("/verify-email", verifyToken))) // AUT-07
	return out, nil
}

type newUser struct {
	Email        string
	Name         string
	PasswordHash string // vazio em conta só Google
	Verified     bool   // e-mail já confirmado (AUT-23)
}

// createUser cria usuário, perfil, categorias padrão e a conta Carteira dentro da transação
// de quem chama (AUT-06). Deixa app.user_id definido na transação, para o RLS aceitar as linhas.
func (s *Service) createUser(ctx context.Context, tx pgx.Tx, in newUser) (store.User, error) {
	q := store.New(tx)
	now := s.now().UTC()
	userID := uuid.New()

	user, err := q.CreateUser(ctx, store.CreateUserParams{
		ID: userID, Email: in.Email, PasswordHash: pgtype.Text{String: in.PasswordHash, Valid: in.PasswordHash != ""},
	})
	if err != nil {
		return store.User{}, err
	}
	if in.Verified {
		if err := q.MarkEmailVerified(ctx, store.MarkEmailVerifiedParams{ID: userID, Now: ts(now)}); err != nil {
			return store.User{}, err
		}
		user.EmailVerifiedAt = ts(now)
	}
	// As linhas abaixo estão sob RLS: valem só com app.user_id definido (PER-05, PER-06).
	if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
		return store.User{}, err
	}
	if err := q.CreateProfile(ctx, store.CreateProfileParams{UserID: userID, Name: in.Name, Now: ts(now)}); err != nil {
		return store.User{}, err
	}
	for i, c := range defaultCategories {
		id, err := uuid.NewV7()
		if err != nil {
			return store.User{}, err
		}
		if err := q.CreateCategory(ctx, store.CreateCategoryParams{
			ID: id, UserID: userID, Name: c.Name, Type: c.Type, Icon: c.Icon, Color: c.Color,
			SortOrder: int32(i), Now: ts(now), //nolint:gosec // índice de uma lista fixa pequena
		}); err != nil {
			return store.User{}, err
		}
	}
	accountID, err := uuid.NewV7()
	if err != nil {
		return store.User{}, err
	}
	if err := q.CreateAccount(ctx, store.CreateAccountParams{
		ID: accountID, UserID: userID, Name: defaultAccountName, Type: defaultAccountType,
		Color: defaultAccountColor, Icon: pgtype.Text{String: defaultAccountIcon, Valid: true}, Now: ts(now),
	}); err != nil {
		return store.User{}, err
	}
	return user, nil
}

func (s *Service) mayRegister(email string) bool {
	switch s.opts.RegistrationMode {
	case "open":
		return true
	case "invite":
		for _, allowed := range s.opts.AllowedEmails {
			if allowed == email {
				return true
			}
		}
	}
	return false
}

// Login confere e-mail e senha (AUT-10), com limite de tentativas (AUT-11).
func (s *Service) Login(ctx context.Context, emailRaw, password string, client ClientInfo) (Tokens, error) {
	email, _ := NormalizeEmail(emailRaw)
	if email == "" {
		email = strings.ToLower(strings.TrimSpace(emailRaw))
	}
	q := store.New(s.db)

	if err := s.checkLoginRate(ctx, q, email, client); err != nil {
		return Tokens{}, err
	}

	user, err := q.GetUserByEmail(ctx, email)
	var found bool
	switch {
	case err == nil:
		found = user.PasswordHash.Valid
	case errors.Is(err, pgx.ErrNoRows):
	default:
		return Tokens{}, err
	}

	// Sempre roda um argon2id, exista o usuário ou não, para o tempo não revelar o e-mail.
	encoded := s.dummyHash
	if found {
		encoded = user.PasswordHash.String
	}
	match, verr := VerifyPassword(password, encoded)
	if verr != nil {
		return Tokens{}, verr
	}
	if !found || !match {
		var uid *uuid.UUID
		if found {
			uid = &user.ID
		}
		if err := s.logEvent(ctx, q, uid, "login_failed", client, map[string]any{"email_hash": emailHash(email)}); err != nil {
			return Tokens{}, err
		}
		return Tokens{}, ErrInvalidCredentials
	}

	var out Tokens
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tq := store.New(tx)
		var err error
		if out, err = s.openSession(ctx, tq, user, client); err != nil {
			return err
		}
		return s.logEvent(ctx, tq, &user.ID, "login", client, nil)
	})
	return out, err
}

func (s *Service) checkLoginRate(ctx context.Context, q *store.Queries, email string, client ClientInfo) error {
	if !client.IP.IsValid() {
		return nil
	}
	now := s.now()
	byEmail, err := q.CountLoginFailuresForEmailIP(ctx, store.CountLoginFailuresForEmailIPParams{
		Ip: client.IP, EmailHash: emailHash(email), Since: ts(now.Add(-loginFailuresWindow)),
	})
	if err != nil {
		return err
	}
	if byEmail.Failures >= loginFailuresLimit {
		return rateLimited(byEmail.Oldest.Time.Add(loginFailuresWindow), now)
	}
	byIP, err := q.CountLoginFailuresForIP(ctx, store.CountLoginFailuresForIPParams{
		Ip: client.IP, Since: ts(now.Add(-ipFailuresWindow)),
	})
	if err != nil {
		return err
	}
	if byIP.Failures >= ipFailuresLimit {
		return rateLimited(byIP.Oldest.Time.Add(ipFailuresWindow), now)
	}
	return nil
}

// RateLimitError leva o Retry-After para o handler.
type RateLimitError struct{ RetryAfter time.Duration }

func (e *RateLimitError) Error() string { return ErrRateLimited.Error() }
func (e *RateLimitError) Unwrap() error { return ErrRateLimited }

func rateLimited(until, now time.Time) error {
	wait := until.Sub(now)
	if wait < time.Second {
		wait = time.Second
	}
	return &RateLimitError{RetryAfter: wait.Round(time.Second)}
}

// Refresh troca o refresh token do cookie por um novo e emite outro token de acesso
// (AUT-13 a AUT-16).
func (s *Service) Refresh(ctx context.Context, refreshToken string, client ClientInfo) (Tokens, error) {
	if refreshToken == "" {
		return Tokens{}, ErrRefreshInvalid
	}
	hash := HashRefreshToken(refreshToken)
	q := store.New(s.db)
	now := s.now().UTC()

	sess, err := q.GetSessionByRefreshHash(ctx, hash)
	switch {
	case err == nil:
		return s.rotate(ctx, q, sess, hash, client, now)
	case !errors.Is(err, pgx.ErrNoRows):
		return Tokens{}, err
	}

	// Não é o token atual: pode ser o anterior (outra aba rotacionou há instantes) ou roubo.
	sess, err = q.GetSessionByPrevRefreshHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return Tokens{}, ErrRefreshInvalid
	}
	if err != nil {
		return Tokens{}, err
	}
	if sess.RevokedAt.Valid {
		return Tokens{}, ErrSessionRevoked
	}
	if sess.PrevValidUntil.Valid && now.Before(sess.PrevValidUntil.Time) && s.sessionAlive(sess, now) {
		// Janela de 10 s (AUT-15): só emite o token de acesso. O refresh novo já foi
		// entregue à outra requisição, e rotacionar de novo derrubaria a sessão.
		return s.accessOnly(ctx, q, sess, now)
	}
	// Token já rotacionado, fora da janela: tratado como roubo (AUT-16).
	if err := q.RevokeSessionByID(ctx, store.RevokeSessionByIDParams{ID: sess.ID, Now: ts(now)}); err != nil {
		return Tokens{}, err
	}
	if err := s.logEvent(ctx, q, &sess.UserID, "refresh_reuse", client, map[string]any{"session_id": sess.ID}); err != nil {
		return Tokens{}, err
	}
	return Tokens{}, ErrRefreshInvalid
}

func (s *Service) sessionAlive(sess store.Session, now time.Time) bool {
	return !sess.RevokedAt.Valid &&
		now.Before(sess.ExpiresAt.Time) &&
		now.Sub(sess.LastUsedAt.Time) < SessionIdleTimeout
}

func (s *Service) rotate(ctx context.Context, q *store.Queries, sess store.Session, oldHash []byte, client ClientInfo, now time.Time) (Tokens, error) {
	if sess.RevokedAt.Valid {
		return Tokens{}, ErrSessionRevoked
	}
	if !s.sessionAlive(sess, now) {
		return Tokens{}, ErrRefreshInvalid
	}
	newToken, newHash, err := NewRefreshToken()
	if err != nil {
		return Tokens{}, err
	}
	rotated, err := q.RotateSession(ctx, store.RotateSessionParams{
		ID: sess.ID, OldRefreshHash: oldHash, NewRefreshHash: newHash,
		PrevValidUntil: ts(now.Add(RefreshGraceWindow)), Now: ts(now),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		// Outra requisição rotacionou entre a leitura e a troca: cai na janela de tolerância.
		fresh, gerr := q.GetSession(ctx, sess.ID)
		if gerr != nil {
			return Tokens{}, gerr
		}
		if fresh.RevokedAt.Valid {
			return Tokens{}, ErrSessionRevoked
		}
		return s.accessOnly(ctx, q, fresh, now)
	}
	if err != nil {
		return Tokens{}, err
	}
	user, err := q.GetUserByID(ctx, rotated.UserID)
	if err != nil {
		return Tokens{}, err
	}
	access, ttl, err := s.signer.Issue(rotated.UserID, rotated.ID, now)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{
		AccessToken: access, ExpiresIn: ttl, RefreshToken: newToken, RefreshExpires: rotated.ExpiresAt.Time,
		User: user, SessionID: rotated.ID,
	}, nil
}

func (s *Service) accessOnly(ctx context.Context, q *store.Queries, sess store.Session, now time.Time) (Tokens, error) {
	user, err := q.GetUserByID(ctx, sess.UserID)
	if err != nil {
		return Tokens{}, err
	}
	access, ttl, err := s.signer.Issue(sess.UserID, sess.ID, now)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{AccessToken: access, ExpiresIn: ttl, RefreshExpires: sess.ExpiresAt.Time, User: user, SessionID: sess.ID}, nil
}

// Logout revoga a sessão do refresh token informado (AUT-19). Token desconhecido não é erro.
func (s *Service) Logout(ctx context.Context, refreshToken string, client ClientInfo) error {
	if refreshToken == "" {
		return nil
	}
	hash := HashRefreshToken(refreshToken)
	q := store.New(s.db)
	sess, err := q.GetSessionByRefreshHash(ctx, hash)
	if errors.Is(err, pgx.ErrNoRows) {
		sess, err = q.GetSessionByPrevRefreshHash(ctx, hash)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := q.RevokeSessionByID(ctx, store.RevokeSessionByIDParams{ID: sess.ID, Now: ts(s.now().UTC())}); err != nil {
		return err
	}
	return s.logEvent(ctx, q, &sess.UserID, "logout", client, nil)
}

// SessionIsLive diz se a sessão do token de acesso ainda vale no banco. Rotas sensíveis
// chamam isto a cada requisição (AUT-20); as demais confiam nos 15 minutos do token.
func (s *Service) SessionIsLive(ctx context.Context, userID, sessionID uuid.UUID) (bool, error) {
	sess, err := store.New(s.db).GetSession(ctx, sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return sess.UserID == userID && s.sessionAlive(sess, s.now().UTC()), nil
}

// ListSessions devolve as sessões ativas do usuário.
func (s *Service) ListSessions(ctx context.Context, userID uuid.UUID) ([]store.Session, error) {
	now := s.now().UTC()
	return store.New(s.db).ListActiveSessions(ctx, store.ListActiveSessionsParams{
		UserID: userID, Now: ts(now), IdleCutoff: ts(now.Add(-SessionIdleTimeout)),
	})
}

// RevokeSession revoga uma sessão do próprio usuário; de outro usuário é NOT_FOUND (PER-03).
func (s *Service) RevokeSession(ctx context.Context, userID, sessionID uuid.UUID, client ClientInfo) error {
	q := store.New(s.db)
	n, err := q.RevokeSession(ctx, store.RevokeSessionParams{ID: sessionID, UserID: userID, Now: ts(s.now().UTC())})
	if err != nil {
		return err
	}
	if n == 0 {
		return httpx.ErrNotFound
	}
	return s.logEvent(ctx, q, &userID, "session_revoked", client, map[string]any{"session_id": sessionID})
}

// RevokeOtherSessions revoga todas as sessões menos a atual.
func (s *Service) RevokeOtherSessions(ctx context.Context, userID, keepSessionID uuid.UUID, client ClientInfo) error {
	q := store.New(s.db)
	n, err := q.RevokeOtherSessions(ctx, store.RevokeOtherSessionsParams{UserID: userID, KeepID: keepSessionID, Now: ts(s.now().UTC())})
	if err != nil {
		return err
	}
	return s.logEvent(ctx, q, &userID, "sessions_revoked", client, map[string]any{"count": n})
}

// GetUser devolve o usuário da sessão.
func (s *Service) GetUser(ctx context.Context, userID uuid.UUID) (store.User, error) {
	user, err := store.New(s.db).GetUserByID(ctx, userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return store.User{}, httpx.ErrNotFound
	}
	return user, err
}

func (s *Service) openSession(ctx context.Context, q *store.Queries, user store.User, client ClientInfo) (Tokens, error) {
	now := s.now().UTC()
	refresh, hash, err := NewRefreshToken()
	if err != nil {
		return Tokens{}, err
	}
	sessionID, err := uuid.NewV7()
	if err != nil {
		return Tokens{}, err
	}
	sess, err := q.CreateSession(ctx, store.CreateSessionParams{
		ID: sessionID, UserID: user.ID, RefreshHash: hash,
		Device:    pgtype.Text{String: truncate(client.UserAgent, 200), Valid: client.UserAgent != ""},
		ExpiresAt: ts(now.Add(SessionMaxLifetime)),
	})
	if err != nil {
		return Tokens{}, err
	}
	access, ttl, err := s.signer.Issue(user.ID, sess.ID, now)
	if err != nil {
		return Tokens{}, err
	}
	return Tokens{
		AccessToken: access, ExpiresIn: ttl, RefreshToken: refresh, RefreshExpires: sess.ExpiresAt.Time,
		User: user, SessionID: sess.ID,
	}, nil
}

// logEvent grava no log de segurança (PER-10). Nunca recebe senha, token ou valores financeiros.
func (s *Service) logEvent(ctx context.Context, q *store.Queries, userID *uuid.UUID, kind string, client ClientInfo, meta map[string]any) error {
	if meta == nil {
		meta = map[string]any{}
	}
	raw, err := json.Marshal(meta)
	if err != nil {
		return err
	}
	var uid uuid.NullUUID
	if userID != nil {
		uid = uuid.NullUUID{UUID: *userID, Valid: true}
	}
	return q.InsertSecurityEvent(ctx, store.InsertSecurityEventParams{
		UserID: uid, Kind: kind, Ip: client.ip(),
		UserAgent: pgtype.Text{String: truncate(client.UserAgent, 200), Valid: client.UserAgent != ""},
		Metadata:  raw,
	})
}

func emailHash(email string) string {
	sum := sha256.Sum256([]byte(email))
	return hex.EncodeToString(sum[:])
}

func truncate(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	return string([]rune(s)[:max])
}

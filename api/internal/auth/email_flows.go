package auth

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/mail"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

const (
	verifyTokenTTL      = 24 * time.Hour  // AUT-07
	resetTokenTTL       = time.Hour       // AUT-25
	emailChangeTokenTTL = time.Hour       // AUT-28
	reauthWindow        = 5 * time.Minute // AUT-30
	mailHourlyLimit     = 3               // AUT-07, AUT-25
	reauthFailuresLimit = 5
	reauthFailuresWin   = 15 * time.Minute
	mailTimeout         = 15 * time.Second

	purposeVerify = "verify_email"
	purposeReset  = "reset_password"
	purposeChange = "change_email"
)

var (
	ErrTokenInvalid      = httpx.NewError(422, "TOKEN_INVALID", "link inválido, vencido ou já usado")
	ErrAlreadyVerified   = httpx.NewError(409, "ALREADY_VERIFIED", "e-mail já verificado")
	ErrNoPassword        = httpx.NewError(409, "NO_PASSWORD", "conta sem senha")
	ErrReauthRequired    = httpx.NewError(403, "REAUTH_REQUIRED", "confirme sua senha de novo")
	ErrEmailNotVerified  = httpx.NewError(403, "EMAIL_NOT_VERIFIED", "verifique seu e-mail primeiro")
	errSameEmail         = httpx.ValidationFailed(httpx.FieldError{Field: "new_email", Reason: "INVALID_VALUE"})
	errBadNewEmailFormat = httpx.ValidationFailed(httpx.FieldError{Field: "new_email", Reason: "INVALID_FORMAT"})
)

// Wait espera os e-mails em andamento terminarem; usado no encerramento da API e nos testes.
func (s *Service) Wait() { s.mailWG.Wait() }

// sendMail envia fora da requisição: o tempo de resposta não pode revelar se o endereço
// existe (AUT-25), e falha de envio só é registrada. O token vai no corpo, nunca no log.
func (s *Service) sendMail(m mail.Message) {
	s.mailWG.Add(1)
	go func() {
		defer s.mailWG.Done()
		ctx, cancel := context.WithTimeout(context.Background(), mailTimeout)
		defer cancel()
		if err := s.opts.Mail.Send(ctx, m); err != nil {
			slog.Default().Error("falha ao enviar e-mail", "subject", m.Subject, "error", err)
		}
	}()
}

func (s *Service) link(path, token string) string {
	return s.opts.AppOrigin + path + "#token=" + token
}

// issueToken grava um link novo (invalidando os anteriores do mesmo tipo) e devolve o token em claro.
func (s *Service) issueToken(ctx context.Context, q *store.Queries, userID uuid.UUID, purpose string, newEmail string, ttl time.Duration) (string, error) {
	token, hash, err := NewRefreshToken()
	if err != nil {
		return "", err
	}
	now := s.now().UTC()
	if err := q.InvalidateAuthTokens(ctx, store.InvalidateAuthTokensParams{UserID: userID, Purpose: purpose, Now: ts(now)}); err != nil {
		return "", err
	}
	err = q.CreateAuthToken(ctx, store.CreateAuthTokenParams{
		UserID: userID, Purpose: purpose, TokenHash: hash,
		NewEmail:  pgtype.Text{String: newEmail, Valid: newEmail != ""},
		ExpiresAt: ts(now.Add(ttl)),
	})
	return token, err
}

// VerifyEmail consome o link de verificação (AUT-07).
func (s *Service) VerifyEmail(ctx context.Context, token string, client ClientInfo) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := s.now().UTC()
		t, err := q.ConsumeAuthToken(ctx, store.ConsumeAuthTokenParams{TokenHash: HashRefreshToken(token), Purpose: purposeVerify, Now: ts(now)})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenInvalid
		}
		if err != nil {
			return err
		}
		if err := q.MarkEmailVerified(ctx, store.MarkEmailVerifiedParams{ID: t.UserID, Now: ts(now)}); err != nil {
			return err
		}
		return s.logEvent(ctx, q, &t.UserID, "email_verified", client, nil)
	})
}

// ResendVerification manda outro link de verificação, no máximo 3 por hora (AUT-07).
func (s *Service) ResendVerification(ctx context.Context, userID uuid.UUID, client ClientInfo) error {
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if user.EmailVerifiedAt.Valid {
		return ErrAlreadyVerified
	}
	var token string
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		if err := s.checkUserLimit(ctx, q, userID, "verify_email_sent", time.Hour, mailHourlyLimit); err != nil {
			return err
		}
		var err error
		if token, err = s.issueToken(ctx, q, userID, purposeVerify, "", verifyTokenTTL); err != nil {
			return err
		}
		return s.logEvent(ctx, q, &userID, "verify_email_sent", client, nil)
	})
	if err != nil {
		return err
	}
	s.sendMail(mail.Verification(user.Email, s.link("/verify-email", token)))
	return nil
}

// ForgotPassword inicia a redefinição (AUT-25). Nunca revela se o e-mail existe: a resposta
// é a mesma com e-mail desconhecido, mal formado ou acima do limite de 3 pedidos por hora.
func (s *Service) ForgotPassword(ctx context.Context, emailRaw string, client ClientInfo) error {
	email, ok := NormalizeEmail(emailRaw)
	if !ok {
		return nil
	}
	q := store.New(s.db)
	now := s.now().UTC()
	hash := emailHash(email)

	recent, err := q.CountEventsByEmailHash(ctx, store.CountEventsByEmailHashParams{Kind: "password_reset_requested", EmailHash: hash, Since: ts(now.Add(-time.Hour))})
	if err != nil {
		return err
	}
	if recent.Events >= mailHourlyLimit {
		return nil
	}
	user, err := q.GetUserByEmail(ctx, email)
	found := err == nil
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var uid *uuid.UUID
	if found {
		uid = &user.ID
	}
	var token string
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tq := store.New(tx)
		if found {
			var err error
			if token, err = s.issueToken(ctx, tq, user.ID, purposeReset, "", resetTokenTTL); err != nil {
				return err
			}
		}
		// Registrado também sem conta, para o limite valer igual e a consulta não vazar nada.
		return s.logEvent(ctx, tq, uid, "password_reset_requested", client, map[string]any{"email_hash": hash})
	})
	if err != nil || !found {
		return err
	}
	s.sendMail(mail.PasswordReset(user.Email, s.link("/reset-password", token)))
	return nil
}

// ResetPassword troca a senha pelo link e encerra todas as sessões (AUT-25, AUT-26).
func (s *Service) ResetPassword(ctx context.Context, token, newPassword string, client ClientInfo) error {
	if err := ValidatePassword(newPassword); err != nil {
		return ErrWeakPassword
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := ts(s.now().UTC())
		t, err := q.ConsumeAuthToken(ctx, store.ConsumeAuthTokenParams{TokenHash: HashRefreshToken(token), Purpose: purposeReset, Now: now})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenInvalid
		}
		if err != nil {
			return err
		}
		if err := q.SetPasswordHash(ctx, store.SetPasswordHashParams{ID: t.UserID, PasswordHash: pgtype.Text{String: hash, Valid: true}, Now: now}); err != nil {
			return err
		}
		// Quem recebeu o link no e-mail provou que o controla.
		if err := q.MarkEmailVerified(ctx, store.MarkEmailVerifiedParams{ID: t.UserID, Now: now}); err != nil {
			return err
		}
		n, err := q.RevokeAllSessions(ctx, store.RevokeAllSessionsParams{UserID: t.UserID, Now: now})
		if err != nil {
			return err
		}
		return s.logEvent(ctx, q, &t.UserID, "password_reset", client, map[string]any{"sessions_revoked": n})
	})
}

// Reauth confere a senha e marca a sessão com reauth_at por 5 minutos (AUT-30).
func (s *Service) Reauth(ctx context.Context, userID, sessID uuid.UUID, password string, client ClientInfo) error {
	q := store.New(s.db)
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.PasswordHash.Valid {
		return ErrNoPassword
	}
	if err := s.checkUserLimit(ctx, q, userID, "reauth_failed", reauthFailuresWin, reauthFailuresLimit); err != nil {
		return err
	}
	match, err := VerifyPassword(password, user.PasswordHash.String)
	if err != nil {
		return err
	}
	if !match {
		if err := s.logEvent(ctx, q, &userID, "reauth_failed", client, nil); err != nil {
			return err
		}
		return ErrInvalidCredentials
	}
	if err := q.SetSessionReauth(ctx, store.SetSessionReauthParams{ID: sessID, Now: ts(s.now().UTC())}); err != nil {
		return err
	}
	return s.logEvent(ctx, q, &userID, "reauth", client, nil)
}

// RequireReauth falha com REAUTH_REQUIRED se a sessão não confirmou a senha nos últimos 5 minutos (AUT-30).
func (s *Service) RequireReauth(ctx context.Context, sessID uuid.UUID) error {
	sess, err := store.New(s.db).GetSession(ctx, sessID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionRevoked
	}
	if err != nil {
		return err
	}
	if !sess.ReauthAt.Valid || s.now().Sub(sess.ReauthAt.Time) > reauthWindow {
		return ErrReauthRequired
	}
	return nil
}

// ChangePassword troca a senha da conta logada e encerra as outras sessões (AUT-26, AUT-27).
func (s *Service) ChangePassword(ctx context.Context, userID, sessID uuid.UUID, current, newPassword string, client ClientInfo) error {
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	q := store.New(s.db)
	if user.PasswordHash.Valid {
		if err := s.checkUserLimit(ctx, q, userID, "reauth_failed", reauthFailuresWin, reauthFailuresLimit); err != nil {
			return err
		}
		match, err := VerifyPassword(current, user.PasswordHash.String)
		if err != nil {
			return err
		}
		if !match {
			if err := s.logEvent(ctx, q, &userID, "reauth_failed", client, nil); err != nil {
				return err
			}
			return ErrInvalidCredentials
		}
	} else if err := s.RequireReauth(ctx, sessID); err != nil { // conta só Google define a primeira senha (AUT-24)
		return err
	}
	if err := ValidatePassword(newPassword); err != nil {
		return ErrWeakPassword
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tq := store.New(tx)
		now := ts(s.now().UTC())
		if err := tq.SetPasswordHash(ctx, store.SetPasswordHashParams{ID: userID, PasswordHash: pgtype.Text{String: hash, Valid: true}, Now: now}); err != nil {
			return err
		}
		n, err := tq.RevokeOtherSessions(ctx, store.RevokeOtherSessionsParams{UserID: userID, KeepID: sessID, Now: now})
		if err != nil {
			return err
		}
		return s.logEvent(ctx, tq, &userID, "password_changed", client, map[string]any{"sessions_revoked": n})
	})
}

// RequestEmailChange manda o link de confirmação ao endereço novo e um aviso ao antigo (AUT-28).
func (s *Service) RequestEmailChange(ctx context.Context, userID, sessID uuid.UUID, newEmailRaw string, client ClientInfo) error {
	if err := s.RequireReauth(ctx, sessID); err != nil {
		return err
	}
	user, err := s.GetUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.EmailVerifiedAt.Valid {
		return ErrEmailNotVerified
	}
	newEmail, ok := NormalizeEmail(newEmailRaw)
	if !ok {
		return errBadNewEmailFormat
	}
	if strings.EqualFold(newEmail, user.Email) {
		return errSameEmail
	}
	q := store.New(s.db)
	if _, err := q.GetUserByEmail(ctx, newEmail); err == nil {
		return ErrEmailTaken
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	var token string
	err = pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		tq := store.New(tx)
		if err := s.checkUserLimit(ctx, tq, userID, "email_change_requested", time.Hour, mailHourlyLimit); err != nil {
			return err
		}
		var err error
		if token, err = s.issueToken(ctx, tq, userID, purposeChange, newEmail, emailChangeTokenTTL); err != nil {
			return err
		}
		return s.logEvent(ctx, tq, &userID, "email_change_requested", client, map[string]any{"new_email_hash": emailHash(newEmail)})
	})
	if err != nil {
		return err
	}
	s.sendMail(mail.EmailChange(newEmail, s.link("/confirm-email", token)))
	s.sendMail(mail.EmailChangeNotice(user.Email, newEmail))
	return nil
}

// ConfirmEmailChange conclui a troca pelo link enviado ao endereço novo (AUT-28).
func (s *Service) ConfirmEmailChange(ctx context.Context, token string, client ClientInfo) error {
	err := pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		q := store.New(tx)
		now := ts(s.now().UTC())
		t, err := q.ConsumeAuthToken(ctx, store.ConsumeAuthTokenParams{TokenHash: HashRefreshToken(token), Purpose: purposeChange, Now: now})
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrTokenInvalid
		}
		if err != nil {
			return err
		}
		if err := q.SetUserEmail(ctx, store.SetUserEmailParams{ID: t.UserID, Email: t.NewEmail.String, Now: now}); err != nil {
			return err
		}
		return s.logEvent(ctx, q, &t.UserID, "email_changed", client, nil)
	})
	if isUniqueViolation(err, "users_email_key") {
		return ErrEmailTaken
	}
	return err
}

// checkUserLimit devolve RATE_LIMITED se o usuário já tem limit eventos do tipo na janela.
func (s *Service) checkUserLimit(ctx context.Context, q *store.Queries, userID uuid.UUID, kind string, window time.Duration, limit int) error {
	now := s.now()
	c, err := q.CountUserEvents(ctx, store.CountUserEventsParams{UserID: uuid.NullUUID{UUID: userID, Valid: true}, Kind: kind, Since: ts(now.Add(-window))})
	if err != nil {
		return err
	}
	if int(c.Events) >= limit {
		return rateLimited(c.Oldest.Time.Add(window), now)
	}
	return nil
}

package server

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/gsmunizz/prumoweb/api/internal/mail"
)

// Testes de e-mail: verificação, redefinição de senha, troca de senha e de e-mail.

// lastToken devolve o token do último e-mail enviado ao endereço, depois de esperar os envios.
func (e *env) lastToken(to string) string {
	e.t.Helper()
	e.srv.Wait()
	var withLink []mail.Message
	for _, m := range e.mail.To(to) {
		if strings.Contains(m.Text, "#token=") {
			withLink = append(withLink, m)
		}
	}
	if len(withLink) == 0 {
		e.t.Fatalf("nenhum e-mail com link para %s", to)
	}
	return tokenFrom(e.t, withLink[len(withLink)-1])
}

func tokenFrom(t *testing.T, m mail.Message) string {
	t.Helper()
	_, rest, ok := strings.Cut(m.Text, appOrigin)
	if !ok {
		t.Fatalf("e-mail sem link: %q", m.Text)
	}
	_, tok, ok := strings.Cut(rest, "#token=")
	if !ok {
		t.Fatalf("link sem token: %q", rest)
	}
	tok, _, _ = strings.Cut(tok, "\n")
	return strings.TrimSpace(tok)
}

func (e *env) reauth(a *account) {
	e.t.Helper()
	if r := e.do("POST", "/auth/reauth", map[string]any{"password": a.password}, bearer(a.access)); r.Code != 204 {
		e.t.Fatalf("reauth: %d %s", r.Code, r.Body)
	}
}

func (e *env) verified(a *account) {
	e.t.Helper()
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": e.lastToken(a.email)}); r.Code != 204 {
		e.t.Fatalf("verify: %d %s", r.Code, r.Body)
	}
}

func TestVerifyEmail(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	// AUT-07: o cadastro manda o link, e a conta usa o app sem verificar.
	token := e.lastToken(a.email)
	if r := e.do("GET", "/me", nil, bearer(a.access)); r.json()["email_verified"] != false {
		t.Fatalf("/me antes: %v", r.json())
	}

	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": "inventado"}); r.Code != 422 || r.errCode() != "TOKEN_INVALID" {
		t.Errorf("token inventado: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": token}); r.Code != 204 {
		t.Fatalf("verificar: %d %s", r.Code, r.Body)
	}
	if r := e.do("GET", "/me", nil, bearer(a.access)); r.json()["email_verified"] != true {
		t.Errorf("/me depois: %v", r.json())
	}
	// Uso único.
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": token}); r.Code != 422 {
		t.Errorf("segundo uso: %d", r.Code)
	}
	if r := e.do("POST", "/auth/verify-email/resend", nil, bearer(a.access)); r.Code != 409 || r.errCode() != "ALREADY_VERIFIED" {
		t.Errorf("reenviar verificada: %d %s", r.Code, r.errCode())
	}
}

func TestVerifyEmailResendIsLimited(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	old := e.lastToken(a.email)

	// Limite de 3 por hora (AUT-07).
	for i := 0; i < 3; i++ {
		if r := e.do("POST", "/auth/verify-email/resend", nil, bearer(a.access)); r.Code != 202 {
			t.Fatalf("reenvio %d: %d %s", i, r.Code, r.Body)
		}
	}
	if r := e.do("POST", "/auth/verify-email/resend", nil, bearer(a.access)); r.Code != 429 || r.Header().Get("Retry-After") == "" {
		t.Errorf("4º reenvio: %d", r.Code)
	}
	// Um link novo invalida o anterior.
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": old}); r.Code != 422 {
		t.Errorf("link antigo depois do reenvio: %d", r.Code)
	}
	fresh := e.lastToken(a.email)
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": fresh}); r.Code != 204 {
		t.Errorf("link novo: %d", r.Code)
	}
}

func TestVerifyLinkExpiresAfter24Hours(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	token := e.lastToken(a.email)
	e.advance(25 * time.Hour)
	if r := e.do("POST", "/auth/verify-email", map[string]any{"token": token}); r.Code != 422 {
		t.Errorf("link de 25 h: %d", r.Code)
	}
}

func TestForgotAndResetPassword(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	other := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.51"))
	otherRefresh := other.cookie(refreshCookie).Value

	// AUT-25: 202 igual, exista o e-mail ou não, e e-mail desconhecido não recebe nada.
	ghost := "ninguem-" + emailSeq()
	for _, addr := range []string{a.email, ghost, "sem-arroba"} {
		if r := e.do("POST", "/auth/password/forgot", map[string]any{"email": addr}); r.Code != 202 || r.Body.Len() != 0 {
			t.Errorf("forgot %q: %d %q", addr, r.Code, r.Body)
		}
	}
	e.srv.Wait()
	if n := len(e.mail.To(ghost)); n != 0 {
		t.Errorf("e-mail desconhecido recebeu %d mensagens", n)
	}
	token := tokenFrom(t, e.mail.To(a.email)[len(e.mail.To(a.email))-1])

	newPass := validPassword + "-nova"
	if r := e.do("POST", "/auth/password/reset", map[string]any{"token": token, "new_password": "curta"}); r.Code != 422 || r.errCode() != "WEAK_PASSWORD" {
		t.Errorf("senha fraca: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/auth/password/reset", map[string]any{"token": token, "new_password": newPass}); r.Code != 204 {
		t.Fatalf("reset: %d %s", r.Code, r.Body)
	}
	// Uso único, e todas as sessões caem (AUT-26).
	if r := e.do("POST", "/auth/password/reset", map[string]any{"token": token, "new_password": newPass}); r.Code != 422 || r.errCode() != "TOKEN_INVALID" {
		t.Errorf("segundo uso: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh)); r.Code != 401 {
		t.Errorf("refresh após reset: %d", r.Code)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(otherRefresh)); r.Code != 401 {
		t.Errorf("refresh da outra sessão após reset: %d", r.Code)
	}
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.52")); r.Code != 401 {
		t.Errorf("senha antiga: %d", r.Code)
	}
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": newPass}, fromIP("203.0.113.53")); r.Code != 200 {
		t.Errorf("senha nova: %d", r.Code)
	}
	// Abrir o link provou o e-mail.
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": newPass}, fromIP("203.0.113.54")); r.json()["user"].(map[string]any)["email_verified"] != true {
		t.Errorf("e-mail não ficou verificado: %v", r.json())
	}
}

func TestResetLinkExpiresAndRequestsAreLimited(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	// 3 pedidos por hora por e-mail; o 4º segue em 202, mas não manda nada.
	b := e.register("Bia")
	for i := 0; i < 4; i++ {
		if r := e.do("POST", "/auth/password/forgot", map[string]any{"email": strings.ToUpper(b.email)}); r.Code != 202 {
			t.Fatalf("pedido %d: %d", i, r.Code)
		}
	}
	e.srv.Wait()
	resets := 0
	for _, m := range e.mail.To(b.email) {
		if strings.Contains(m.Subject, "Redefinição") {
			resets++
		}
	}
	if resets != 3 {
		t.Errorf("e-mails de redefinição = %d, esperava 3", resets)
	}

	// O link vale 1 hora.
	e.do("POST", "/auth/password/forgot", map[string]any{"email": a.email})
	token := e.lastToken(a.email)
	e.advance(61 * time.Minute)
	if r := e.do("POST", "/auth/password/reset", map[string]any{"token": token, "new_password": validPassword + "-x"}); r.Code != 422 || r.errCode() != "TOKEN_INVALID" {
		t.Errorf("link de 61 min: %d %s", r.Code, r.errCode())
	}
}

func TestReauthAndChangePassword(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	second := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.60"))
	secondRefresh := second.cookie(refreshCookie).Value

	newPass := validPassword + "-troca"
	if r := e.do("PUT", "/me/password", map[string]any{"current_password": wrongPassword, "new_password": newPass}, bearer(a.access)); r.Code != 401 || r.errCode() != "INVALID_CREDENTIALS" {
		t.Errorf("senha atual errada: %d %s", r.Code, r.errCode())
	}
	if r := e.do("PUT", "/me/password", map[string]any{"current_password": a.password, "new_password": "1234567890"}, bearer(a.access)); r.Code != 422 || r.errCode() != "WEAK_PASSWORD" {
		t.Errorf("senha fraca: %d %s", r.Code, r.errCode())
	}
	if r := e.do("PUT", "/me/password", map[string]any{"current_password": a.password, "new_password": newPass}, bearer(a.access)); r.Code != 204 {
		t.Fatalf("trocar: %d %s", r.Code, r.Body)
	}
	// AUT-26: a sessão atual segue; as outras caem.
	if r := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh)); r.Code != 200 {
		t.Errorf("sessão atual: %d", r.Code)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(secondRefresh)); r.Code != 401 {
		t.Errorf("outra sessão: %d", r.Code)
	}

	// Reautenticação: senha errada não marca a sessão; limite de 5 falhas.
	if r := e.do("POST", "/auth/reauth", map[string]any{"password": wrongPassword}, bearer(a.access)); r.Code != 401 {
		t.Errorf("reauth errada: %d", r.Code)
	}
	for i := 0; i < 4; i++ {
		e.do("POST", "/auth/reauth", map[string]any{"password": wrongPassword}, bearer(a.access))
	}
	if r := e.do("POST", "/auth/reauth", map[string]any{"password": newPass}, bearer(a.access)); r.Code != 429 {
		t.Errorf("reauth após 5 falhas: %d", r.Code)
	}
}

func TestChangeEmail(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	newEmail := emailSeq()

	// AUT-28: sem reautenticação e sem e-mail verificado, nada feito.
	if r := e.do("POST", "/me/email", map[string]any{"new_email": newEmail}, bearer(a.access)); r.Code != 403 || r.errCode() != "REAUTH_REQUIRED" {
		t.Errorf("sem reauth: %d %s", r.Code, r.errCode())
	}
	e.reauth(a)
	if r := e.do("POST", "/me/email", map[string]any{"new_email": newEmail}, bearer(a.access)); r.Code != 403 || r.errCode() != "EMAIL_NOT_VERIFIED" {
		t.Errorf("sem verificar: %d %s", r.Code, r.errCode())
	}
	e.verified(a)

	taken := e.register("Bia")
	if r := e.do("POST", "/me/email", map[string]any{"new_email": taken.email}, bearer(a.access)); r.Code != 409 || r.errCode() != "EMAIL_TAKEN" {
		t.Errorf("e-mail em uso: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/me/email", map[string]any{"new_email": "sem-arroba"}, bearer(a.access)); r.Code != 422 {
		t.Errorf("formato: %d", r.Code)
	}
	if r := e.do("POST", "/me/email", map[string]any{"new_email": strings.ToUpper(a.email)}, bearer(a.access)); r.Code != 422 {
		t.Errorf("mesmo e-mail: %d", r.Code)
	}

	if r := e.do("POST", "/me/email", map[string]any{"new_email": newEmail}, bearer(a.access)); r.Code != 202 {
		t.Fatalf("pedir troca: %d %s", r.Code, r.Body)
	}
	e.srv.Wait()
	// O link vai ao endereço novo e o antigo recebe só o aviso, sem link.
	token := e.lastToken(newEmail)
	var notice mail.Message
	for _, m := range e.mail.To(a.email) {
		if strings.Contains(m.Subject, "troca de e-mail") {
			notice = m
		}
	}
	if notice.To == "" || strings.Contains(notice.Text, "#token=") || !strings.Contains(notice.Text, newEmail) {
		t.Errorf("aviso ao e-mail antigo: %+v", notice)
	}
	if r := e.do("GET", "/me", nil, bearer(a.access)); r.json()["email"] != a.email {
		t.Errorf("e-mail mudou antes de confirmar: %v", r.json()["email"])
	}

	// O link de verificação não serve para confirmar a troca, e vice-versa.
	if r := e.do("POST", "/me/email/confirm", map[string]any{"token": e.lastToken(a.email)}); r.Code != 422 {
		t.Errorf("token de outro tipo: %d", r.Code)
	}
	if r := e.do("POST", "/me/email/confirm", map[string]any{"token": token}); r.Code != 204 {
		t.Fatalf("confirmar: %d %s", r.Code, r.Body)
	}
	if r := e.do("POST", "/me/email/confirm", map[string]any{"token": token}); r.Code != 422 {
		t.Errorf("segundo uso: %d", r.Code)
	}
	me := e.do("GET", "/me", nil, bearer(a.access)).json()
	if me["email"] != newEmail || me["email_verified"] != true {
		t.Errorf("/me depois da troca: %v", me)
	}
	if r := e.do("POST", "/auth/login", map[string]any{"email": newEmail, "password": a.password}, fromIP("203.0.113.70")); r.Code != 200 {
		t.Errorf("login com o e-mail novo: %d", r.Code)
	}
}

func TestChangeEmailRaceKeepsEmailsUnique(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	e.reauth(a)
	e.verified(a)
	target := emailSeq()
	if r := e.do("POST", "/me/email", map[string]any{"new_email": target}, bearer(a.access)); r.Code != 202 {
		t.Fatalf("pedir troca: %d", r.Code)
	}
	token := e.lastToken(target)

	// Alguém cadastra o endereço antes da confirmação.
	r := e.do("POST", "/auth/register", map[string]any{"email": target, "password": validPassword, "name": "B", "accept_terms": true})
	if r.Code != http.StatusCreated {
		t.Fatalf("register: %d", r.Code)
	}
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, target) })
	if r := e.do("POST", "/me/email/confirm", map[string]any{"token": token}); r.Code != 409 || r.errCode() != "EMAIL_TAKEN" {
		t.Errorf("confirmar com e-mail ocupado: %d %s", r.Code, r.errCode())
	}
}

func TestMailFailureDoesNotBreakRegistration(t *testing.T) {
	e := newEnv(t, "open")
	e.mail.Err = context.DeadlineExceeded
	email := emailSeq()
	r := e.do("POST", "/auth/register", map[string]any{"email": email, "password": validPassword, "name": "A", "accept_terms": true})
	if r.Code != http.StatusCreated {
		t.Fatalf("register com e-mail fora do ar: %d %s", r.Code, r.Body)
	}
	e.srv.Wait()
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })
}

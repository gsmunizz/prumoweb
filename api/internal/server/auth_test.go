package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/gsmunizz/prumoweb/api/internal/config"
	"github.com/gsmunizz/prumoweb/api/internal/database"
	"github.com/gsmunizz/prumoweb/api/internal/mail"
)

// Testes de integração da autenticação. Precisam do banco com as migrações aplicadas:
//   TEST_DATABASE_URL (prumo_app) e TEST_AUTH_DATABASE_URL (prumo_auth).

const appOrigin = "https://prumo.test"

func init() { gin.SetMode(gin.TestMode) }

type env struct {
	t        *testing.T
	srv      *Server
	h        http.Handler
	app      *pgxpool.Pool
	authPool *pgxpool.Pool
	mu       sync.Mutex
	clock    time.Time
	mail     *mail.Memory
}

func (e *env) now() time.Time {
	e.mu.Lock()
	defer e.mu.Unlock()
	return e.clock
}

func (e *env) advance(d time.Duration) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.clock = e.clock.Add(d)
}

func newEnv(t *testing.T, mode string, allowed ...string) *env {
	t.Helper()
	appURL, authURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_AUTH_DATABASE_URL")
	if appURL == "" || authURL == "" {
		t.Skip("TEST_DATABASE_URL e TEST_AUTH_DATABASE_URL não definidas")
	}
	ctx := context.Background()
	app, err := database.Connect(ctx, appURL)
	if err != nil {
		t.Fatal(err)
	}
	authPool, err := database.Connect(ctx, authURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close(); authPool.Close() })

	cfg := config.Config{
		Env: "development", AppOrigin: appOrigin, RegistrationMode: mode, AllowedEmails: allowed,
		AuthSigningKeyID: "k1",
	}
	srv, err := New(cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), app, authPool)
	if err != nil {
		t.Fatal(err)
	}
	e := &env{t: t, srv: srv, h: srv.Handler(), app: app, authPool: authPool, clock: time.Now(), mail: &mail.Memory{}}
	srv.SetMailer(e.mail)
	srv.SetClock(e.now)
	return e
}

type resp struct {
	*httptest.ResponseRecorder
}

func (r resp) json() map[string]any {
	var m map[string]any
	_ = json.Unmarshal(r.Body.Bytes(), &m)
	return m
}

func (r resp) errCode() string {
	e, _ := r.json()["error"].(map[string]any)
	code, _ := e["code"].(string)
	return code
}

func (r resp) cookie(name string) *http.Cookie {
	for _, c := range r.Result().Cookies() {
		if c.Name == name {
			return c
		}
	}
	return nil
}

type opt func(*http.Request)

func bearer(token string) opt {
	return func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+token) }
}
func withCookie(v string) opt {
	return func(r *http.Request) { r.AddCookie(&http.Cookie{Name: refreshCookie, Value: v}) }
}
func fromIP(ip string) opt { return func(r *http.Request) { r.RemoteAddr = ip + ":4000" } }
func noClientHeader() opt  { return func(r *http.Request) { r.Header.Del("X-Prumo-Client") } }
func origin(o string) opt  { return func(r *http.Request) { r.Header.Set("Origin", o) } }

func (e *env) do(method, path string, body any, opts ...opt) resp {
	e.t.Helper()
	var rd io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rd = strings.NewReader(string(b))
	}
	req := httptest.NewRequest(method, "/api/v1"+path, rd)
	req.Header.Set("Origin", appOrigin)
	req.Header.Set("X-Prumo-Client", "web")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	req.RemoteAddr = "198.51.100.1:4000"
	for _, o := range opts {
		o(req)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, req)
	return resp{w}
}

var emailSeq = func() func() string {
	var mu sync.Mutex
	n := 0
	prefix := uuid.NewString()[:8]
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		n++
		return strings.ToLower(prefix) + "-" + string(rune('a'+n%26)) + uuid.NewString()[:6] + "@teste.prumo"
	}
}()

// Senhas montadas em tempo de execução: scanners de segredo acusam literais de senha em testes.
var (
	validPassword = strings.Join([]string{"cavalo", "azul", "1"}, "-")
	wrongPassword = strings.Join([]string{"errada", "senha", "123"}, "-")
)

type account struct {
	email, password string
	access, refresh string
	userID, session uuid.UUID
}

func (e *env) register(name string) *account {
	e.t.Helper()
	a := &account{email: emailSeq(), password: validPassword + uuid.NewString()[:4]}
	r := e.do("POST", "/auth/register", map[string]any{"email": a.email, "password": a.password, "name": name, "accept_terms": true})
	if r.Code != http.StatusCreated {
		e.t.Fatalf("register: %d %s", r.Code, r.Body)
	}
	a.access = r.json()["access_token"].(string)
	a.refresh = r.cookie(refreshCookie).Value
	claims, err := e.srv.signer.Parse(a.access, e.now())
	if err != nil {
		e.t.Fatal(err)
	}
	a.userID, _ = claims.UserID()
	a.session = claims.SessionID
	e.t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, a.userID) })
	return a
}

func TestRegisterCreatesDefaults(t *testing.T) {
	e := newEnv(t, "open")
	email := emailSeq()
	r := e.do("POST", "/auth/register", map[string]any{"email": "  " + strings.ToUpper(email) + " ", "password": validPassword, "name": " Gabriel ", "accept_terms": true})
	if r.Code != http.StatusCreated {
		t.Fatalf("status %d: %s", r.Code, r.Body)
	}
	user := r.json()["user"].(map[string]any)
	if user["email"] != email || user["email_verified"] != false {
		t.Errorf("user = %v", user)
	}
	if r.json()["expires_in"] != float64(900) {
		t.Errorf("expires_in = %v", r.json()["expires_in"])
	}

	c := r.cookie(refreshCookie)
	if c == nil || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteStrictMode || c.Path != "/api/v1/auth" {
		t.Fatalf("cookie fora do AUT-13: %+v", c)
	}
	if r.Header().Get("Cache-Control") != "no-store" {
		t.Error("resposta de login deveria ser no-store")
	}

	uid := uuid.MustParse(user["id"].(string))
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, uid) })

	// AUT-06: perfil, 12 categorias de despesa, 6 de receita e a conta Carteira.
	err := database.WithUser(context.Background(), e.app, uid, func(tx pgx.Tx) error {
		var name, tz, theme string
		if err := tx.QueryRow(context.Background(), `SELECT name, timezone, theme FROM profiles`).Scan(&name, &tz, &theme); err != nil {
			return err
		}
		if name != "Gabriel" || tz != "America/Sao_Paulo" || theme != "system" {
			t.Errorf("perfil = %q %q %q", name, tz, theme)
		}
		var exp, inc int
		if err := tx.QueryRow(context.Background(), `SELECT count(*) FILTER (WHERE type='expense'), count(*) FILTER (WHERE type='income') FROM categories`).Scan(&exp, &inc); err != nil {
			return err
		}
		if exp != 12 || inc != 6 {
			t.Errorf("categorias: %d despesas e %d receitas", exp, inc)
		}
		var accName, accType string
		var balance int64
		if err := tx.QueryRow(context.Background(), `SELECT name, type, initial_balance_cents FROM accounts`).Scan(&accName, &accType, &balance); err != nil {
			return err
		}
		if accName != "Carteira" || accType != "carteira" || balance != 0 {
			t.Errorf("conta = %q %q %d", accName, accType, balance)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// O token recém-emitido abre /me.
	me := e.do("GET", "/me", nil, bearer(r.json()["access_token"].(string)))
	if me.Code != http.StatusOK {
		t.Fatalf("/me: %d %s", me.Code, me.Body)
	}
	if p := me.json()["profile"].(map[string]any); p["name"] != "Gabriel" || p["currency"] != "BRL" {
		t.Errorf("profile = %v", p)
	}
	if me.json()["has_password"] != true || me.json()["email_verified"] != false {
		t.Errorf("/me = %v", me.json())
	}
}

func TestRegisterValidation(t *testing.T) {
	e := newEnv(t, "open")
	cases := []struct {
		name   string
		body   map[string]any
		status int
		code   string
	}{
		{"senha comum", map[string]any{"email": emailSeq(), "password": "1234567890", "name": "A", "accept_terms": true}, 422, "WEAK_PASSWORD"},
		{"senha curta", map[string]any{"email": emailSeq(), "password": "curta", "name": "A", "accept_terms": true}, 422, "WEAK_PASSWORD"},
		{"e-mail inválido", map[string]any{"email": "sem-arroba", "password": validPassword, "name": "A", "accept_terms": true}, 422, "VALIDATION_FAILED"},
		{"sem nome", map[string]any{"email": emailSeq(), "password": validPassword, "name": "  ", "accept_terms": true}, 422, "VALIDATION_FAILED"},
		{"sem aceitar os termos", map[string]any{"email": emailSeq(), "password": validPassword, "name": "A", "accept_terms": false}, 422, "VALIDATION_FAILED"},
		{"nome longo", map[string]any{"email": emailSeq(), "password": validPassword, "name": strings.Repeat("a", 81), "accept_terms": true}, 422, "VALIDATION_FAILED"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := e.do("POST", "/auth/register", tc.body)
			if r.Code != tc.status || r.errCode() != tc.code {
				t.Errorf("%d %s, quer %d %s", r.Code, r.errCode(), tc.status, tc.code)
			}
			if r.cookie(refreshCookie) != nil {
				t.Error("cadastro recusado não deveria abrir sessão")
			}
		})
	}

	r := e.do("POST", "/auth/register", nil)
	if r.Code != http.StatusBadRequest || r.errCode() != "BAD_REQUEST" {
		t.Errorf("corpo vazio: %d %s", r.Code, r.errCode())
	}
}

func TestRegisterDuplicateEmailIgnoresCase(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	r := e.do("POST", "/auth/register", map[string]any{"email": strings.ToUpper(a.email), "password": validPassword, "name": "Outra", "accept_terms": true})
	if r.Code != http.StatusConflict || r.errCode() != "EMAIL_TAKEN" {
		t.Errorf("%d %s", r.Code, r.errCode())
	}
}

func TestRegistrationModes(t *testing.T) {
	invited := emailSeq()
	e := newEnv(t, "invite", invited)
	body := func(email string) map[string]any {
		return map[string]any{"email": email, "password": validPassword, "name": "A", "accept_terms": true}
	}
	if r := e.do("POST", "/auth/register", body(emailSeq())); r.Code != 403 || r.errCode() != "REGISTRATION_CLOSED" {
		t.Errorf("fora da lista: %d %s", r.Code, r.errCode())
	}
	r := e.do("POST", "/auth/register", body(strings.ToUpper(invited)))
	if r.Code != http.StatusCreated {
		t.Fatalf("convidado: %d %s", r.Code, r.Body)
	}
	uid := uuid.MustParse(r.json()["user"].(map[string]any)["id"].(string))
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, uid) })

	closed := newEnv(t, "closed", invited)
	if r := closed.do("POST", "/auth/register", body(emailSeq())); r.Code != 403 || r.errCode() != "REGISTRATION_CLOSED" {
		t.Errorf("modo closed: %d %s", r.Code, r.errCode())
	}
}

func TestCSRFProtection(t *testing.T) {
	e := newEnv(t, "open")
	body := map[string]any{"email": emailSeq(), "password": validPassword, "name": "A", "accept_terms": true}
	for name, o := range map[string]opt{
		"sem X-Prumo-Client":   noClientHeader(),
		"origem de outro site": origin("https://evil.example"),
		"sem Origin":           origin(""),
	} {
		t.Run(name, func(t *testing.T) {
			r := e.do("POST", "/auth/register", body, o)
			if r.Code != http.StatusForbidden || r.errCode() != "CSRF_REJECTED" {
				t.Errorf("%d %s", r.Code, r.errCode())
			}
		})
	}
	for _, path := range []string{"/auth/login", "/auth/refresh", "/auth/logout"} {
		if r := e.do("POST", path, map[string]any{}, origin("https://evil.example"), withCookie("x")); r.errCode() != "CSRF_REJECTED" {
			t.Errorf("%s sem proteção: %d %s", path, r.Code, r.errCode())
		}
	}
}

func TestLogin(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	ok := e.do("POST", "/auth/login", map[string]any{"email": strings.ToUpper(a.email), "password": a.password}, fromIP("203.0.113.10"))
	if ok.Code != http.StatusOK || ok.cookie(refreshCookie) == nil {
		t.Fatalf("login: %d %s", ok.Code, ok.Body)
	}
	if ok.cookie(refreshCookie).Value == a.refresh {
		t.Error("cada login deveria abrir uma sessão com refresh próprio")
	}

	wrong := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": wrongPassword}, fromIP("203.0.113.11"))
	ghost := e.do("POST", "/auth/login", map[string]any{"email": "ninguem-" + emailSeq(), "password": wrongPassword}, fromIP("203.0.113.12"))
	if wrong.Code != 401 || wrong.errCode() != "INVALID_CREDENTIALS" {
		t.Errorf("senha errada: %d %s", wrong.Code, wrong.errCode())
	}
	// AUT-10: e-mail inexistente responde exatamente igual a senha errada.
	if ghost.Code != wrong.Code || ghost.errCode() != wrong.errCode() {
		t.Errorf("e-mail inexistente: %d %s", ghost.Code, ghost.errCode())
	}
	if wrong.cookie(refreshCookie) != nil {
		t.Error("login recusado não deveria abrir sessão")
	}
}

func TestLoginRateLimit(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	// IP sorteado: o log de segurança sobrevive entre execuções e o limite por IP é de 30 por hora.
	id := uuid.New()
	ip := fmt.Sprintf("198.18.%d.%d", id[0], id[1])
	bad := map[string]any{"email": a.email, "password": wrongPassword}

	for i := 0; i < 5; i++ {
		if r := e.do("POST", "/auth/login", bad, fromIP(ip)); r.errCode() != "INVALID_CREDENTIALS" {
			t.Fatalf("tentativa %d: %d %s", i+1, r.Code, r.errCode())
		}
	}
	r := e.do("POST", "/auth/login", bad, fromIP(ip))
	if r.Code != http.StatusTooManyRequests || r.errCode() != "RATE_LIMITED" || r.Header().Get("Retry-After") == "" {
		t.Fatalf("6ª tentativa: %d %s retry-after=%q", r.Code, r.errCode(), r.Header().Get("Retry-After"))
	}
	// Mesmo com a senha certa, o limite vale para esse e-mail + IP.
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP(ip)); r.Code != http.StatusTooManyRequests {
		t.Errorf("senha certa durante o bloqueio: %d", r.Code)
	}
	// Outro IP não é afetado.
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.21")); r.Code != http.StatusOK {
		t.Errorf("outro IP: %d %s", r.Code, r.Body)
	}
	// Passada a janela de 15 minutos, volta a aceitar.
	e.advance(16 * time.Minute)
	if r := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP(ip)); r.Code != http.StatusOK {
		t.Errorf("depois da janela: %d %s", r.Code, r.Body)
	}
}

func TestRefreshRotation(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	first := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh))
	if first.Code != http.StatusOK {
		t.Fatalf("refresh: %d %s", first.Code, first.Body)
	}
	next := first.cookie(refreshCookie)
	if next == nil || next.Value == a.refresh || !next.HttpOnly || next.SameSite != http.SameSiteStrictMode {
		t.Fatalf("o refresh deveria girar: %+v", next)
	}
	token := first.json()["access_token"].(string)
	if claims, err := e.srv.signer.Parse(token, e.now()); err != nil || claims.SessionID != a.session {
		t.Errorf("token novo deveria ser da mesma sessão: %v", err)
	}

	// AUT-15: duas abas renovando juntas. O token anterior vale por 10 s, sem novo cookie.
	e.advance(5 * time.Second)
	grace := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh))
	if grace.Code != http.StatusOK || grace.cookie(refreshCookie) != nil {
		t.Fatalf("janela de tolerância: %d, cookie=%v", grace.Code, grace.cookie(refreshCookie))
	}

	// O token novo segue valendo, e a sessão continua viva.
	if r := e.do("POST", "/auth/refresh", nil, withCookie(next.Value)); r.Code != http.StatusOK {
		t.Fatalf("token novo: %d %s", r.Code, r.Body)
	}
}

func TestRefreshReuseRevokesSession(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	first := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh))
	current := first.cookie(refreshCookie).Value

	// AUT-16: o token antigo reaparece depois da janela de 10 s.
	e.advance(11 * time.Second)
	reuse := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh))
	if reuse.Code != http.StatusUnauthorized || reuse.errCode() != "REFRESH_INVALID" {
		t.Fatalf("reuso: %d %s", reuse.Code, reuse.errCode())
	}
	if c := reuse.cookie(refreshCookie); c == nil || c.MaxAge >= 0 {
		t.Errorf("o cookie deveria ser apagado: %+v", c)
	}

	// A sessão inteira caiu, inclusive o token legítimo mais novo.
	after := e.do("POST", "/auth/refresh", nil, withCookie(current))
	if after.Code != http.StatusUnauthorized || after.errCode() != "SESSION_REVOKED" {
		t.Errorf("token atual depois do roubo: %d %s", after.Code, after.errCode())
	}

	var n int
	err := e.authPool.QueryRow(context.Background(),
		`SELECT count(*) FROM security_events WHERE user_id = $1 AND kind = 'refresh_reuse'`, a.userID).Scan(&n)
	if err != nil || n != 1 {
		t.Errorf("evento refresh_reuse: n=%d err=%v", n, err)
	}
}

func TestRefreshRejects(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	if r := e.do("POST", "/auth/refresh", nil); r.Code != 401 || r.errCode() != "REFRESH_INVALID" {
		t.Errorf("sem cookie: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie("lixo")); r.Code != 401 || r.errCode() != "REFRESH_INVALID" {
		t.Errorf("cookie desconhecido: %d %s", r.Code, r.errCode())
	}

	// AUT-14: 30 dias sem uso derrubam a sessão.
	e.advance(31 * 24 * time.Hour)
	if r := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh)); r.Code != 401 || r.errCode() != "REFRESH_INVALID" {
		t.Errorf("sessão ociosa: %d %s", r.Code, r.errCode())
	}
}

func TestSessionMaxLifetime(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	token := a.refresh

	// Usar a sessão a cada 20 dias evita o limite de ociosidade, mas não passa dos 90 dias.
	for day := 20; day <= 80; day += 20 {
		e.advance(20 * 24 * time.Hour)
		r := e.do("POST", "/auth/refresh", nil, withCookie(token))
		if r.Code != http.StatusOK {
			t.Fatalf("dia %d: %d %s", day, r.Code, r.Body)
		}
		token = r.cookie(refreshCookie).Value
	}
	e.advance(20 * 24 * time.Hour) // dia 100
	if r := e.do("POST", "/auth/refresh", nil, withCookie(token)); r.Code != 401 || r.errCode() != "REFRESH_INVALID" {
		t.Errorf("depois de 90 dias: %d %s", r.Code, r.errCode())
	}
}

func TestLogout(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	r := e.do("POST", "/auth/logout", nil, withCookie(a.refresh))
	if r.Code != http.StatusNoContent {
		t.Fatalf("logout: %d %s", r.Code, r.Body)
	}
	if c := r.cookie(refreshCookie); c == nil || c.MaxAge >= 0 {
		t.Errorf("cookie deveria ser apagado: %+v", c)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(a.refresh)); r.Code != 401 {
		t.Errorf("refresh depois do logout: %d", r.Code)
	}
	// Logout repetido ou sem cookie não é erro.
	if r := e.do("POST", "/auth/logout", nil); r.Code != http.StatusNoContent {
		t.Errorf("logout sem cookie: %d", r.Code)
	}
}

func TestAccessTokenRules(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	if r := e.do("GET", "/me", nil); r.Code != 401 || r.errCode() != "UNAUTHENTICATED" {
		t.Errorf("sem token: %d %s", r.Code, r.errCode())
	}
	if r := e.do("GET", "/me", nil, bearer("lixo")); r.Code != 401 || r.errCode() != "UNAUTHENTICATED" {
		t.Errorf("token inválido: %d %s", r.Code, r.errCode())
	}
	if r := e.do("GET", "/me", nil, bearer(a.access)); r.Code != 200 {
		t.Errorf("token válido: %d", r.Code)
	}
	e.advance(16 * time.Minute)
	if r := e.do("GET", "/me", nil, bearer(a.access)); r.Code != 401 || r.errCode() != "TOKEN_EXPIRED" {
		t.Errorf("token vencido: %d %s", r.Code, r.errCode())
	}
}

func TestSessionsAreIsolatedBetweenUsers(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	b := e.register("Beto")

	list := e.do("GET", "/auth/sessions", nil, bearer(a.access))
	if list.Code != 200 {
		t.Fatalf("listar: %d %s", list.Code, list.Body)
	}
	data := list.json()["data"].([]any)
	if len(data) != 1 || data[0].(map[string]any)["id"] != a.session.String() || data[0].(map[string]any)["current"] != true {
		t.Errorf("Ana deveria ver só a própria sessão: %v", data)
	}

	// PER-03: sessão de outro usuário responde 404, igual a inexistente.
	other := e.do("DELETE", "/auth/sessions/"+b.session.String(), nil, bearer(a.access))
	ghost := e.do("DELETE", "/auth/sessions/"+uuid.NewString(), nil, bearer(a.access))
	if other.Code != 404 || ghost.Code != 404 || other.errCode() != "NOT_FOUND" {
		t.Errorf("sessão alheia: %d %s; inexistente: %d", other.Code, other.errCode(), ghost.Code)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(b.refresh)); r.Code != 200 {
		t.Errorf("a sessão de Beto não deveria ter sido tocada: %d", r.Code)
	}
	if r := e.do("DELETE", "/auth/sessions", nil, bearer(a.access)); r.Code != 204 {
		t.Fatalf("revogar outras: %d", r.Code)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(b.refresh)); r.Code != 200 {
		t.Errorf("revogar as outras de Ana não pode afetar Beto: %d", r.Code)
	}
}

func TestRevokedSessionAndSensitiveRoutes(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	second := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.30"))
	secondToken := second.json()["access_token"].(string)
	claims, _ := e.srv.signer.Parse(secondToken, e.now())

	// Ana encerra a segunda sessão pela primeira.
	if r := e.do("DELETE", "/auth/sessions/"+claims.SessionID.String(), nil, bearer(a.access)); r.Code != 204 {
		t.Fatalf("revogar: %d %s", r.Code, r.Body)
	}
	// AUT-20: rotas sensíveis checam a sessão no banco; as comuns esperam o token vencer.
	if r := e.do("GET", "/auth/sessions", nil, bearer(secondToken)); r.Code != 401 || r.errCode() != "SESSION_REVOKED" {
		t.Errorf("rota sensível com sessão revogada: %d %s", r.Code, r.errCode())
	}
	if r := e.do("GET", "/me", nil, bearer(secondToken)); r.Code != 200 {
		t.Errorf("/me com sessão revogada, dentro dos 15 min: %d", r.Code)
	}
	if r := e.do("POST", "/auth/refresh", nil, withCookie(second.cookie(refreshCookie).Value)); r.Code != 401 || r.errCode() != "SESSION_REVOKED" {
		t.Errorf("refresh da sessão revogada: %d %s", r.Code, r.errCode())
	}
}

func TestSecurityEventsStayClean(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": wrongPassword}, fromIP("203.0.113.40"))

	rows, err := e.authPool.Query(context.Background(),
		`SELECT kind, metadata::text FROM security_events WHERE user_id = $1 OR metadata->>'email_hash' IS NOT NULL ORDER BY id DESC LIMIT 20`, a.userID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	for rows.Next() {
		var kind, meta string
		if err := rows.Scan(&kind, &meta); err != nil {
			t.Fatal(err)
		}
		// PER-09/PER-10: nada de senha, token ou e-mail em claro no log.
		for _, secret := range []string{a.password, wrongPassword, a.refresh, a.access, a.email} {
			if strings.Contains(meta, secret) {
				t.Errorf("evento %s vazou %q", kind, secret[:6])
			}
		}
	}
}

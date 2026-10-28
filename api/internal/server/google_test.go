package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
	"github.com/google/uuid"

	"github.com/gsmunizz/prumoweb/api/internal/auth"
)

// Testes do login com Google contra um provedor OIDC falso (descoberta, JWKS e token).

const fakeClientID = "cliente-de-teste.apps.example"

type fakeGoogle struct {
	t      *testing.T
	srv    *httptest.Server
	key    *rsa.PrivateKey
	mu     sync.Mutex
	codes  map[string]fakeCode
	nextID int
}

type fakeCode struct {
	claims    map[string]any
	nonce     string
	challenge string
}

func newFakeGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeGoogle{t: t, key: key, codes: map[string]fakeCode{}}
	mux := http.NewServeMux()
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"issuer": f.srv.URL, "authorization_endpoint": f.srv.URL + "/auth", "token_endpoint": f.srv.URL + "/token",
			"jwks_uri": f.srv.URL + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"},
		})
	})
	mux.HandleFunc("/keys", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "g1", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("/token", f.token)
	f.srv = httptest.NewServer(mux)
	t.Cleanup(f.srv.Close)
	return f
}

// token confere o code e o verifier PKCE e devolve um id_token assinado.
func (f *fakeGoogle) token(w http.ResponseWriter, r *http.Request) {
	_ = r.ParseForm()
	f.mu.Lock()
	fc, ok := f.codes[r.Form.Get("code")]
	delete(f.codes, r.Form.Get("code"))
	f.mu.Unlock()
	sum := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
	if !ok || base64.RawURLEncoding.EncodeToString(sum[:]) != fc.challenge {
		http.Error(w, `{"error":"invalid_grant"}`, http.StatusBadRequest)
		return
	}
	signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: f.key}, (&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "g1"))
	if err != nil {
		f.t.Error(err)
		return
	}
	claims := map[string]any{
		"iss": f.srv.URL, "aud": fakeClientID, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "nonce": fc.nonce,
	}
	for k, v := range fc.claims {
		claims[k] = v
	}
	raw, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		f.t.Error(err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "x", "token_type": "Bearer", "id_token": raw})
}

// authorize imita o navegador no Google: lê a URL do /google/start e devolve o code do retorno.
func (f *fakeGoogle) authorize(location string, claims map[string]any) (code, state string) {
	f.t.Helper()
	u, err := url.Parse(location)
	if err != nil {
		f.t.Fatal(err)
	}
	q := u.Query()
	if q.Get("code_challenge_method") != "S256" || q.Get("code_challenge") == "" || q.Get("state") == "" || q.Get("nonce") == "" ||
		q.Get("response_type") != "code" || q.Get("client_id") != fakeClientID {
		f.t.Fatalf("URL de autorização incompleta: %s", location)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	code = "code-" + uuid.NewString()
	f.codes[code] = fakeCode{claims: claims, nonce: q.Get("nonce"), challenge: q.Get("code_challenge")}
	return code, q.Get("state")
}

func (e *env) enableGoogle(t *testing.T) *fakeGoogle {
	t.Helper()
	f := newFakeGoogle(t)
	e.srv.auth.SetGoogle(auth.GoogleConfig{
		ClientID: fakeClientID, ClientSecret: "segredo-de-teste", RedirectURL: appOrigin + "/api/v1/auth/google/callback", Issuer: f.srv.URL,
	})
	return f
}

// googleFlow percorre start → Google → callback e devolve a resposta do callback.
func (e *env) googleFlow(f *fakeGoogle, intent string, claims map[string]any, opts ...opt) resp {
	e.t.Helper()
	start := e.do("GET", "/auth/google/start?intent="+intent, nil, opts...)
	if start.Code != http.StatusFound {
		e.t.Fatalf("start: %d %s", start.Code, start.Body)
	}
	oidcCookie := start.cookie("prumo_oidc")
	if oidcCookie == nil || !oidcCookie.HttpOnly || oidcCookie.SameSite != http.SameSiteLaxMode {
		e.t.Fatalf("cookie prumo_oidc: %+v", oidcCookie)
	}
	code, state := f.authorize(start.Header().Get("Location"), claims)
	return e.do("GET", "/auth/google/callback?code="+code+"&state="+state, nil, func(r *http.Request) {
		r.AddCookie(&http.Cookie{Name: "prumo_oidc", Value: oidcCookie.Value})
		r.Header.Del("Origin")
		r.Header.Del("X-Prumo-Client")
	})
}

func (r resp) redirect() *url.URL {
	u, _ := url.Parse(r.Header().Get("Location"))
	return u
}

func googleClaims(sub, email string, verified bool) map[string]any {
	return map[string]any{"sub": sub, "email": email, "email_verified": verified, "name": "Gabriel Google"}
}

func TestGoogleNotConfigured(t *testing.T) {
	e := newEnv(t, "open")
	if r := e.do("GET", "/auth/google/start", nil); r.Code != 404 {
		t.Errorf("sem configuração: %d", r.Code)
	}
}

func TestGoogleFirstLoginCreatesAccount(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)
	email, sub := emailSeq(), "sub-"+uuid.NewString()
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })

	r := e.googleFlow(f, "login", googleClaims(sub, email, true))
	if r.Code != http.StatusFound || r.redirect().Path != "/auth/callback" || r.redirect().Query().Get("error") != "" {
		t.Fatalf("callback: %d %s", r.Code, r.Header().Get("Location"))
	}
	if r.cookie("prumo_oidc").MaxAge >= 0 {
		t.Error("cookie prumo_oidc deveria ser apagado no callback")
	}
	rt := r.cookie(refreshCookie)
	if rt == nil || !rt.HttpOnly || rt.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie de sessão: %+v", rt)
	}
	// O app troca o cookie por um token de acesso, como depois de qualquer login.
	ref := e.do("POST", "/auth/refresh", nil, withCookie(rt.Value))
	if ref.Code != 200 {
		t.Fatalf("refresh: %d %s", ref.Code, ref.Body)
	}
	me := e.do("GET", "/me", nil, bearer(ref.json()["access_token"].(string))).json()
	// AUT-23: e-mail verificado, sem senha, com Google vinculado e o perfil criado como no cadastro.
	if me["email"] != email || me["email_verified"] != true || me["has_password"] != false || me["google_linked"] != true {
		t.Errorf("/me = %v", me)
	}
	if p := me["profile"].(map[string]any); p["name"] != "Gabriel Google" || p["currency"] != "BRL" {
		t.Errorf("perfil = %v", p)
	}

	// Segundo login: mesma identidade, mesma conta.
	again := e.googleFlow(f, "login", googleClaims(sub, email, true))
	if again.redirect().Query().Get("error") != "" || again.cookie(refreshCookie) == nil {
		t.Errorf("segundo login: %s", again.Header().Get("Location"))
	}
}

func TestGoogleRejections(t *testing.T) {
	e := newEnv(t, "closed")
	f := e.enableGoogle(t)

	// AUT-22: sem e-mail verificado pelo Google.
	r := e.googleFlow(f, "login", googleClaims("sub-"+uuid.NewString(), emailSeq(), false))
	if got := r.redirect().Query().Get("error"); got != "EMAIL_NOT_VERIFIED" || r.cookie(refreshCookie) != nil {
		t.Errorf("e-mail não verificado: error=%q", got)
	}
	// AUT-01: cadastro fechado vale também para o Google.
	r = e.googleFlow(f, "login", googleClaims("sub-"+uuid.NewString(), emailSeq(), true))
	if got := r.redirect().Query().Get("error"); got != "REGISTRATION_CLOSED" {
		t.Errorf("cadastro fechado: error=%q", got)
	}
}

func TestGoogleLinksVerifiedAccountAndDemandsPasswordForUnverified(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)

	// AUT-22: conta com e-mail igual e já verificado é vinculada.
	verified := e.register("Ana")
	e.verified(verified)
	r := e.googleFlow(f, "login", googleClaims("sub-"+uuid.NewString(), verified.email, true))
	if r.redirect().Query().Get("error") != "" || r.cookie(refreshCookie) == nil {
		t.Fatalf("vincular conta verificada: %s", r.Header().Get("Location"))
	}
	if me := e.do("GET", "/me", nil, bearer(verified.access)).json(); me["google_linked"] != true || me["has_password"] != true {
		t.Errorf("/me depois de vincular: %v", me)
	}

	// Conta não verificada: ninguém entra pelo Google na conta dela antes de provar a senha.
	unverified := e.register("Bia")
	r = e.googleFlow(f, "login", googleClaims("sub-"+uuid.NewString(), unverified.email, true))
	if got := r.redirect().Query().Get("error"); got != "ACCOUNT_LINK_REQUIRED" || r.cookie(refreshCookie) != nil {
		t.Errorf("conta não verificada: error=%q", got)
	}
	if me := e.do("GET", "/me", nil, bearer(unverified.access)).json(); me["google_linked"] != false {
		t.Errorf("/me da conta não verificada: %v", me)
	}
}

func TestGoogleCallbackValidation(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)
	email := emailSeq()
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })

	start := e.do("GET", "/auth/google/start?intent=login", nil)
	cookie := start.cookie("prumo_oidc").Value
	code, state := f.authorize(start.Header().Get("Location"), googleClaims("sub-"+uuid.NewString(), email, true))
	call := func(query, ck string) resp {
		return e.do("GET", "/auth/google/callback?"+query, nil, func(r *http.Request) {
			if ck != "" {
				r.AddCookie(&http.Cookie{Name: "prumo_oidc", Value: ck})
			}
		})
	}
	failed := func(name string, r resp) {
		t.Helper()
		if got := r.redirect().Query().Get("error"); got != "OIDC_FAILED" || r.cookie(refreshCookie) != nil {
			t.Errorf("%s: error=%q location=%s", name, got, r.Header().Get("Location"))
		}
	}
	failed("sem cookie", call("code="+code+"&state="+state, ""))
	failed("state trocado", call("code="+code+"&state=outro", cookie))
	failed("cookie adulterado", call("code="+code+"&state="+state, cookie[:len(cookie)-3]+"AAA"))
	failed("sem code", call("state="+state, cookie))
	failed("recusado no Google", call("error=access_denied&state="+state, cookie))
	// Nenhuma das tentativas gastou o code: o fluxo legítimo ainda fecha.
	ok := call("code="+code+"&state="+state, cookie)
	if ok.redirect().Query().Get("error") != "" || ok.cookie(refreshCookie) == nil {
		t.Fatalf("fluxo legítimo: %s", ok.Header().Get("Location"))
	}
	// O code é de uso único.
	failed("code reutilizado", call("code="+code+"&state="+state, cookie))

	// Cookie vencido (10 min).
	start = e.do("GET", "/auth/google/start?intent=login", nil)
	code, state = f.authorize(start.Header().Get("Location"), googleClaims("sub-"+uuid.NewString(), emailSeq(), true))
	e.advance(11 * time.Minute)
	failed("cookie vencido", call("code="+code+"&state="+state, start.cookie("prumo_oidc").Value))
}

func TestGoogleIDTokenChecks(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)
	cases := map[string]map[string]any{
		"audience errada": {"aud": "outro-cliente"},
		"nonce errado":    {"nonce": "outro"},
		"token vencido":   {"exp": time.Now().Add(-time.Hour).Unix()},
		"emissor errado":  {"iss": "https://evil.example"},
	}
	for name, override := range cases {
		claims := googleClaims("sub-"+uuid.NewString(), emailSeq(), true)
		for k, v := range override {
			claims[k] = v
		}
		r := e.googleFlow(f, "login", claims)
		if got := r.redirect().Query().Get("error"); got != "OIDC_FAILED" || r.cookie(refreshCookie) != nil {
			t.Errorf("%s: error=%q", name, got)
		}
	}
}

func TestGoogleLinkUnlinkAndReauth(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)
	a := e.register("Ana")
	sub := "sub-" + uuid.NewString()

	// Sem sessão, vincular não começa.
	if r := e.do("GET", "/auth/google/start?intent=link", nil); r.Code != http.StatusFound || r.redirect().Query().Get("error") != "UNAUTHENTICATED" {
		t.Errorf("link sem sessão: %d %s", r.Code, r.Header().Get("Location"))
	}
	if r := e.do("GET", "/auth/google/start?intent=xyz", nil); r.Code != 422 {
		t.Errorf("intent inválida: %d", r.Code)
	}

	// Vincular com a sessão do cookie. O e-mail do Google pode ser outro.
	r := e.googleFlow(f, "link", googleClaims(sub, emailSeq(), true), withCookie(a.refresh))
	if r.redirect().Query().Get("error") != "" || r.cookie(refreshCookie) != nil {
		t.Fatalf("vincular: %s", r.Header().Get("Location"))
	}
	if me := e.do("GET", "/me", nil, bearer(a.access)).json(); me["google_linked"] != true {
		t.Fatalf("/me: %v", me)
	}

	// A mesma conta Google não vincula a outro usuário.
	b := e.register("Bia")
	r = e.googleFlow(f, "link", googleClaims(sub, emailSeq(), true), withCookie(b.refresh))
	if got := r.redirect().Query().Get("error"); got != "GOOGLE_ALREADY_LINKED" {
		t.Errorf("Google de outro usuário: error=%q", got)
	}

	// Reautenticação pelo Google (AUT-30): libera a troca de senha sem senha atual? Não —
	// libera as rotas que pedem reauth; aqui, a troca de e-mail (que ainda pede e-mail verificado).
	if r := e.do("POST", "/me/email", map[string]any{"new_email": emailSeq()}, bearer(a.access)); r.errCode() != "REAUTH_REQUIRED" {
		t.Errorf("antes do reauth: %s", r.errCode())
	}
	r = e.googleFlow(f, "reauth", googleClaims(sub, emailSeq(), true), withCookie(a.refresh))
	if r.redirect().Query().Get("error") != "" {
		t.Fatalf("reauth: %s", r.Header().Get("Location"))
	}
	if r := e.do("POST", "/me/email", map[string]any{"new_email": emailSeq()}, bearer(a.access)); r.errCode() != "EMAIL_NOT_VERIFIED" {
		t.Errorf("depois do reauth: %d %s", r.Code, r.errCode())
	}
	// Reauth com outra conta Google não vale.
	r = e.googleFlow(f, "reauth", googleClaims("sub-"+uuid.NewString(), emailSeq(), true), withCookie(b.refresh))
	if got := r.redirect().Query().Get("error"); got != "OIDC_FAILED" {
		t.Errorf("reauth de quem não vinculou: error=%q", got)
	}

	// Desvincular: ok com senha; o usuário só Google não pode.
	if r := e.do("DELETE", "/me/google", nil, bearer(a.access)); r.Code != 204 {
		t.Errorf("desvincular: %d %s", r.Code, r.Body)
	}
	if r := e.do("DELETE", "/me/google", nil, bearer(a.access)); r.Code != 404 {
		t.Errorf("desvincular de novo: %d", r.Code)
	}
}

func TestGoogleOnlyUserCannotUnlinkButCanSetPassword(t *testing.T) {
	e := newEnv(t, "open")
	f := e.enableGoogle(t)
	email, sub := emailSeq(), "sub-"+uuid.NewString()
	t.Cleanup(func() { _, _ = e.authPool.Exec(context.Background(), `DELETE FROM users WHERE email = $1`, email) })

	r := e.googleFlow(f, "login", googleClaims(sub, email, true))
	ref := e.do("POST", "/auth/refresh", nil, withCookie(r.cookie(refreshCookie).Value))
	access, rt := ref.json()["access_token"].(string), ref.cookie(refreshCookie).Value // o refresh gira o cookie

	// AUT-24: sem senha, o Google é o único método de login.
	if r := e.do("DELETE", "/me/google", nil, bearer(access)); r.Code != 409 || r.errCode() != "LAST_LOGIN_METHOD" {
		t.Errorf("desvincular o único método: %d %s", r.Code, r.errCode())
	}
	// Reautenticação por senha não existe para quem não tem senha.
	if r := e.do("POST", "/auth/reauth", map[string]any{"password": validPassword}, bearer(access)); r.Code != 409 || r.errCode() != "NO_PASSWORD" {
		t.Errorf("reauth por senha: %d %s", r.Code, r.errCode())
	}
	// Definir a primeira senha exige ter reautenticado pelo Google.
	newPass := validPassword + "-google"
	if r := e.do("PUT", "/me/password", map[string]any{"new_password": newPass}, bearer(access)); r.Code != 403 || r.errCode() != "REAUTH_REQUIRED" {
		t.Errorf("senha sem reauth: %d %s", r.Code, r.errCode())
	}
	r = e.googleFlow(f, "reauth", googleClaims(sub, email, true), withCookie(rt))
	if r.redirect().Query().Get("error") != "" {
		t.Fatalf("reauth: %s", r.Header().Get("Location"))
	}
	if r := e.do("PUT", "/me/password", map[string]any{"new_password": newPass}, bearer(access)); r.Code != 204 {
		t.Fatalf("definir senha: %d %s", r.Code, r.Body)
	}
	if r := e.do("POST", "/auth/login", map[string]any{"email": email, "password": newPass}, fromIP("203.0.113.80")); r.Code != 200 {
		t.Errorf("login com a senha nova: %d", r.Code)
	}
	if r := e.do("DELETE", "/me/google", nil, bearer(access)); r.Code != 204 {
		t.Errorf("desvincular com senha definida: %d", r.Code)
	}
}

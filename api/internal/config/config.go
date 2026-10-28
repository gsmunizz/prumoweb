// Package config lê a configuração da API das variáveis de ambiente.
// Segredos nunca ficam no repositório; em produção vêm do provedor de hospedagem.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"
)

type Config struct {
	Env  string // development | production
	Port string
	// AppOrigin é a origem do frontend (ex.: https://prumo.vercel.app). A API só aceita
	// requisições com cookie vindas dela (AUT-17). Domínio próprio entra só trocando este valor.
	AppOrigin string
	// DatabaseURL conecta como prumo_app (sujeito ao RLS); AuthDatabaseURL como prumo_auth.
	DatabaseURL     string
	AuthDatabaseURL string
	// RegistrationMode: invite (padrão até a fase 3), open ou closed (AUT-01).
	RegistrationMode string
	AllowedEmails    []string
	Version          string
	// AuthSigningKey é a semente Ed25519 (32 bytes em base64) que assina os tokens de acesso,
	// e AuthSigningKeyID o kid dela. Gere com `go run ./cmd/keygen`. Em desenvolvimento, sem
	// semente, a API usa uma chave temporária (os tokens morrem a cada reinício).
	AuthSigningKey   string
	AuthSigningKeyID string
	// AuthPreviousKeys são chaves públicas anteriores ainda aceitas na validação durante uma
	// rotação, no formato "kid:base64,kid2:base64" (AUT-12).
	AuthPreviousKeys []string
	// TrustedProxies são os CIDRs dos proxies à frente da API cujo X-Forwarded-For vale.
	// Sem isso, o IP visto é o da conexão, e os limites de login (AUT-11) contam o proxy.
	TrustedProxies []string
	// ResendAPIKey e MailFrom configuram o envio de e-mails (verificação, redefinição de senha).
	// Sem a chave, em desenvolvimento, as mensagens vão para o log. Enquanto o Prumo não tiver
	// domínio próprio verificado no Resend, o remetente de teste só entrega ao dono da conta.
	ResendAPIKey string
	MailFrom     string
	// GoogleClientID e GoogleClientSecret ligam o login com Google (AUT-21). Vazios, as rotas
	// /auth/google/* respondem 404. GoogleRedirectURL é o callback cadastrado no Google; o
	// padrão é APP_ORIGIN + /api/v1/auth/google/callback.
	GoogleClientID     string
	GoogleClientSecret string
	GoogleRedirectURL  string
}

func Load() (Config, error) {
	c := Config{
		Env:                getenv("PRUMO_ENV", "development"),
		Port:               getenv("PORT", "8080"),
		AppOrigin:          strings.TrimRight(os.Getenv("APP_ORIGIN"), "/"),
		DatabaseURL:        os.Getenv("DATABASE_URL"),
		AuthDatabaseURL:    os.Getenv("AUTH_DATABASE_URL"),
		RegistrationMode:   getenv("REGISTRATION_MODE", "invite"),
		AllowedEmails:      splitList(os.Getenv("ALLOWED_EMAILS")),
		Version:            getenv("PRUMO_VERSION", "dev"),
		AuthSigningKey:     os.Getenv("AUTH_SIGNING_KEY"),
		AuthSigningKeyID:   getenv("AUTH_SIGNING_KEY_ID", "k1"),
		AuthPreviousKeys:   splitCSV(os.Getenv("AUTH_PREVIOUS_PUBLIC_KEYS")),
		TrustedProxies:     splitCSV(os.Getenv("TRUSTED_PROXIES")),
		ResendAPIKey:       os.Getenv("RESEND_API_KEY"),
		MailFrom:           getenv("MAIL_FROM", "Prumo <onboarding@resend.dev>"),
		GoogleClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		GoogleRedirectURL:  os.Getenv("GOOGLE_REDIRECT_URL"),
	}

	if c.GoogleRedirectURL == "" {
		c.GoogleRedirectURL = c.AppOrigin + "/api/v1/auth/google/callback"
	}

	var errs []error
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL é obrigatória"))
	}
	if c.AuthDatabaseURL == "" {
		errs = append(errs, errors.New("AUTH_DATABASE_URL é obrigatória"))
	}
	if c.AppOrigin == "" {
		errs = append(errs, errors.New("APP_ORIGIN é obrigatória"))
	}
	switch c.RegistrationMode {
	case "invite", "open", "closed":
	default:
		errs = append(errs, fmt.Errorf("REGISTRATION_MODE inválido: %q", c.RegistrationMode))
	}
	if c.Env != "development" && c.Env != "production" {
		errs = append(errs, fmt.Errorf("PRUMO_ENV inválido: %q", c.Env))
	}
	if c.IsProduction() && c.AuthSigningKey == "" {
		errs = append(errs, errors.New("AUTH_SIGNING_KEY é obrigatória em produção"))
	}
	if c.IsProduction() && c.ResendAPIKey == "" {
		errs = append(errs, errors.New("RESEND_API_KEY é obrigatória em produção"))
	}
	if (c.GoogleClientID == "") != (c.GoogleClientSecret == "") {
		errs = append(errs, errors.New("GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET devem vir juntas"))
	}
	return c, errors.Join(errs...)
}

func (c Config) IsProduction() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func splitCSV(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.TrimSpace(item); item != "" {
			out = append(out, item)
		}
	}
	return out
}

func splitList(s string) []string {
	var out []string
	for _, item := range strings.Split(s, ",") {
		if item = strings.ToLower(strings.TrimSpace(item)); item != "" {
			out = append(out, item)
		}
	}
	return out
}

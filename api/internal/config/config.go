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
}

func Load() (Config, error) {
	c := Config{
		Env:              getenv("PRUMO_ENV", "development"),
		Port:             getenv("PORT", "8080"),
		AppOrigin:        strings.TrimRight(os.Getenv("APP_ORIGIN"), "/"),
		DatabaseURL:      os.Getenv("DATABASE_URL"),
		AuthDatabaseURL:  os.Getenv("AUTH_DATABASE_URL"),
		RegistrationMode: getenv("REGISTRATION_MODE", "invite"),
		AllowedEmails:    splitList(os.Getenv("ALLOWED_EMAILS")),
		Version:          getenv("PRUMO_VERSION", "dev"),
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
	return c, errors.Join(errs...)
}

func (c Config) IsProduction() bool { return c.Env == "production" }

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
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

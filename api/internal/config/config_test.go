package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://app")
	t.Setenv("AUTH_DATABASE_URL", "postgres://auth")
	t.Setenv("APP_ORIGIN", "http://localhost:5173/")
	t.Setenv("ALLOWED_EMAILS", " Gabriel@Example.com , ,outra@example.com")

	c, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if c.AppOrigin != "http://localhost:5173" {
		t.Errorf("AppOrigin = %q", c.AppOrigin)
	}
	if got := strings.Join(c.AllowedEmails, ","); got != "gabriel@example.com,outra@example.com" {
		t.Errorf("AllowedEmails = %q", got)
	}
	if c.RegistrationMode != "invite" {
		t.Errorf("RegistrationMode = %q, quer invite por padrão", c.RegistrationMode)
	}
}

func TestLoadMissing(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	t.Setenv("AUTH_DATABASE_URL", "")
	t.Setenv("APP_ORIGIN", "")
	t.Setenv("REGISTRATION_MODE", "aberto")

	_, err := Load()
	if err == nil {
		t.Fatal("esperava erro")
	}
	for _, want := range []string{"DATABASE_URL", "AUTH_DATABASE_URL", "APP_ORIGIN", "REGISTRATION_MODE"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("erro não cita %s: %v", want, err)
		}
	}
}

func TestLoadProductionRequiresSigningKey(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://app")
	t.Setenv("AUTH_DATABASE_URL", "postgres://auth")
	t.Setenv("APP_ORIGIN", "https://prumo.example")
	t.Setenv("PRUMO_ENV", "production")
	t.Setenv("AUTH_SIGNING_KEY", "")

	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "AUTH_SIGNING_KEY") {
		t.Fatalf("produção sem chave deveria falhar, veio %v", err)
	}
	t.Setenv("AUTH_SIGNING_KEY", "c2VtZW50ZQ==")
	t.Setenv("RESEND_API_KEY", "")
	if _, err := Load(); err == nil || !strings.Contains(err.Error(), "RESEND_API_KEY") {
		t.Fatalf("produção sem chave do Resend deveria falhar, veio %v", err)
	}
	t.Setenv("RESEND_API_KEY", "re_chave_de_teste")
	if _, err := Load(); err != nil {
		t.Fatal(err)
	}
}

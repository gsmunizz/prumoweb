package auth

import (
	"errors"
	"strings"
	"testing"
)

func TestValidatePassword(t *testing.T) {
	tests := []struct {
		name     string
		password string
		want     error
	}{
		{"curta", "abc12345", ErrPasswordLength},
		{"nove caracteres", "123456789", ErrPasswordLength},
		{"dez caracteres", "cavalo-azul", nil},
		{"longa demais", strings.Repeat("a", 129), ErrPasswordLength},
		{"limite de 128", strings.Repeat("a", 128), nil},
		{"comum", "1234567890", ErrPasswordWeak},
		{"comum com maiúsculas", "PassWord123", nil}, // fora da lista: só o que está nela é recusado
		{"acentos contam como um caractere", "órgão-ação", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ValidatePassword(tt.password); !errors.Is(got, tt.want) {
				t.Errorf("ValidatePassword(%q) = %v, quer %v", tt.password, got, tt.want)
			}
		})
	}
}

func TestCommonPasswordsCaseInsensitive(t *testing.T) {
	for p := range commonPasswords {
		if got := ValidatePassword(strings.ToUpper(p)); !errors.Is(got, ErrPasswordWeak) {
			t.Fatalf("%q em maiúsculas deveria ser recusada, veio %v", p, got)
		}
		return
	}
	t.Fatal("lista de senhas comuns vazia")
}

func TestHashAndVerify(t *testing.T) {
	hash, err := HashPassword("cavalo-azul")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=1$") {
		t.Errorf("formato inesperado: %s", hash)
	}
	if ok, err := VerifyPassword("cavalo-azul", hash); err != nil || !ok {
		t.Errorf("senha certa: ok=%v err=%v", ok, err)
	}
	if ok, err := VerifyPassword("cavalo-verde", hash); err != nil || ok {
		t.Errorf("senha errada: ok=%v err=%v", ok, err)
	}
	other, _ := HashPassword("cavalo-azul")
	if hash == other {
		t.Error("o salt deveria tornar cada hash diferente")
	}
}

func TestVerifyRejectsBadHashes(t *testing.T) {
	for _, h := range []string{
		"",
		"texto-solto",
		"$bcrypt$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA",
		"$argon2id$v=19$m=4294967295,t=3,p=1$c2FsdA$aGFzaA", // memória absurda
		"$argon2id$v=19$m=65536,t=3,p=0$c2FsdA$aGFzaA",
	} {
		if ok, err := VerifyPassword("x", h); ok || err == nil {
			t.Errorf("VerifyPassword(%q) = %v, %v; quer erro", h, ok, err)
		}
	}
}

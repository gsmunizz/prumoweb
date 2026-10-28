// Package auth reúne as regras de autenticação do Prumo: senhas, tokens de acesso,
// refresh tokens rotativos e sessões (AUT-*).
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	_ "embed"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

// Parâmetros do argon2id (AUT-04). Ficam gravados junto do hash, então subir o
// custo no futuro não invalida as senhas já cadastradas.
const (
	argonMemoryKiB = 64 * 1024 // 64 MiB
	argonTime      = 3
	argonThreads   = 1
	argonSaltLen   = 16
	argonKeyLen    = 32
)

const (
	MinPasswordLen = 10
	MaxPasswordLen = 128
)

var (
	ErrPasswordLength = errors.New("senha deve ter de 10 a 128 caracteres")
	ErrPasswordWeak   = errors.New("senha está entre as mais comuns")
)

// common_passwords.txt: senhas com 10 caracteres ou mais da lista das 10 mil mais
// comuns do SecLists (MIT), em minúsculas, uma por linha. Menores já caem no mínimo.
//
//go:embed common_passwords.txt
var commonPasswordsRaw string

var commonPasswords = func() map[string]struct{} {
	m := make(map[string]struct{})
	for _, p := range strings.Split(commonPasswordsRaw, "\n") {
		if p = strings.TrimSpace(p); p != "" {
			m[p] = struct{}{}
		}
	}
	return m
}()

// ValidatePassword aplica AUT-03: 10 a 128 caracteres, sem regra de composição,
// e fora da lista de senhas comuns.
func ValidatePassword(password string) error {
	n := utf8.RuneCountInString(password)
	if n < MinPasswordLen || n > MaxPasswordLen {
		return ErrPasswordLength
	}
	if _, ok := commonPasswords[strings.ToLower(password)]; ok {
		return ErrPasswordWeak
	}
	return nil
}

// HashPassword devolve o hash argon2id no formato PHC:
// $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
func HashPassword(password string) (string, error) {
	salt := make([]byte, argonSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	key := argon2.IDKey([]byte(password), salt, argonTime, argonMemoryKiB, argonThreads, argonKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, argonMemoryKiB, argonTime, argonThreads,
		base64.RawStdEncoding.EncodeToString(salt), base64.RawStdEncoding.EncodeToString(key)), nil
}

// VerifyPassword confere a senha contra um hash PHC, em tempo constante.
func VerifyPassword(password, encoded string) (bool, error) {
	parts := strings.Split(encoded, "$")
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false, errors.New("hash de senha em formato desconhecido")
	}
	var version int
	if _, err := fmt.Sscanf(parts[2], "v=%d", &version); err != nil || version != argon2.Version {
		return false, errors.New("versão do argon2 não suportada")
	}
	var memory, iterations uint32
	var threads uint8
	if _, err := fmt.Sscanf(parts[3], "m=%d,t=%d,p=%d", &memory, &iterations, &threads); err != nil {
		return false, errors.New("parâmetros do argon2 inválidos")
	}
	// Teto nos parâmetros lidos do banco, para um hash corrompido não esgotar a memória.
	if memory > 1<<20 || iterations > 10 || threads == 0 || threads > 8 {
		return false, errors.New("parâmetros do argon2 fora do limite")
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false, err
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false, errors.New("hash de senha inválido")
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, threads, uint32(len(want))) //nolint:gosec // len(want) vem de hash que a própria API gravou
	return subtle.ConstantTimeCompare(got, want) == 1, nil
}

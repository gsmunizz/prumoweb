package auth

import (
	"crypto/ed25519"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func testSigner(t *testing.T, kid string) *Signer {
	t.Helper()
	seed := make([]byte, ed25519.SeedSize)
	copy(seed, kid)
	s, err := NewSigner(kid, seed, nil)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func TestIssueAndParse(t *testing.T) {
	s := testSigner(t, "k1")
	user, session := uuid.New(), uuid.New()
	now := time.Now()

	token, ttl, err := s.Issue(user, session, now)
	if err != nil || ttl != 15*time.Minute {
		t.Fatalf("Issue: ttl=%v err=%v", ttl, err)
	}
	claims, err := s.Parse(token, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := claims.UserID(); got != user || claims.SessionID != session {
		t.Errorf("claims = %+v", claims)
	}
}

func TestParseRejects(t *testing.T) {
	s := testSigner(t, "k1")
	now := time.Now()
	token, _, _ := s.Issue(uuid.New(), uuid.New(), now)

	if _, err := s.Parse(token, now.Add(AccessTokenTTL+time.Second)); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("token vencido: %v", err)
	}
	if _, err := testSigner(t, "k2").Parse(token, now); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("kid desconhecido: %v", err)
	}
	// Mesmo kid, outra chave: assinatura não confere.
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 9
	forged, _ := NewSigner("k1", seed, nil)
	forgedToken, _, _ := forged.Issue(uuid.New(), uuid.New(), now)
	if _, err := s.Parse(forgedToken, now); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("assinatura de outra chave: %v", err)
	}
	if _, err := s.Parse("nao.e.jwt", now); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("lixo: %v", err)
	}
}

func TestParseRejectsOtherAlgorithms(t *testing.T) {
	s := testSigner(t, "k1")
	// alg=none nunca pode passar.
	tok := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{
		SessionID: uuid.New(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: Issuer, Audience: jwt.ClaimStrings{Audience}, Subject: uuid.NewString(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	tok.Header["kid"] = "k1"
	signed, err := tok.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Parse(signed, time.Now()); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("alg=none aceito: %v", err)
	}
}

func TestParseRejectsWrongAudience(t *testing.T) {
	s := testSigner(t, "k1")
	tok := jwt.NewWithClaims(jwt.SigningMethodEdDSA, Claims{
		SessionID: uuid.New(),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer: Issuer, Audience: jwt.ClaimStrings{"outro-app"}, Subject: uuid.NewString(),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	})
	tok.Header["kid"] = "k1"
	signed, _ := tok.SignedString(s.priv)
	if _, err := s.Parse(signed, time.Now()); !errors.Is(err, ErrInvalidToken) {
		t.Errorf("audience errada aceita: %v", err)
	}
}

func TestKeyRotation(t *testing.T) {
	old := testSigner(t, "k1")
	seed := make([]byte, ed25519.SeedSize)
	seed[0] = 7
	rotated, err := NewSigner("k2", seed, map[string]ed25519.PublicKey{"k1": old.priv.Public().(ed25519.PublicKey)})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	oldToken, _, _ := old.Issue(uuid.New(), uuid.New(), now)
	if _, err := rotated.Parse(oldToken, now); err != nil {
		t.Errorf("token da chave anterior deveria valer até expirar: %v", err)
	}
}

func TestNewSignerValidation(t *testing.T) {
	if _, err := NewSigner("", make([]byte, 32), nil); err == nil {
		t.Error("kid vazio aceito")
	}
	if _, err := NewSigner("k1", make([]byte, 16), nil); err == nil {
		t.Error("semente curta aceita")
	}
}

func TestRefreshToken(t *testing.T) {
	a, ha, err := NewRefreshToken()
	if err != nil {
		t.Fatal(err)
	}
	b, _, _ := NewRefreshToken()
	if a == b || len(ha) != 32 {
		t.Error("tokens deveriam ser únicos e o hash ter 32 bytes")
	}
	if string(HashRefreshToken(a)) != string(ha) {
		t.Error("o hash deveria ser reproduzível a partir do token")
	}
}

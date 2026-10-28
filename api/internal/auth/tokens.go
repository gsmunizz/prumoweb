package auth

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	Issuer   = "prumo"
	Audience = "prumo-web"

	AccessTokenTTL = 15 * time.Minute // AUT-12
)

var (
	ErrInvalidToken = errors.New("token de acesso inválido")
	// ErrTokenExpired acompanha ErrInvalidToken quando o token é válido mas venceu:
	// o cliente renova em silêncio e repete a chamada.
	ErrTokenExpired = errors.New("token de acesso vencido")
)

// Claims são as claims do token de acesso (AUT-12): sub é o user_id e sid a sessão.
type Claims struct {
	SessionID uuid.UUID `json:"sid"`
	jwt.RegisteredClaims
}

func (c Claims) UserID() (uuid.UUID, error) { return uuid.Parse(c.Subject) }

// Signer assina e valida os JWT de acesso com Ed25519. O kid no cabeçalho permite
// girar a chave: chaves antigas ficam em Verify até os tokens expirarem (15 min).
type Signer struct {
	kid    string
	priv   ed25519.PrivateKey
	verify map[string]ed25519.PublicKey
}

// NewSigner cria o Signer a partir da semente de 32 bytes da chave Ed25519.
// extraPublic traz chaves públicas anteriores (kid → chave) aceitas só na validação.
func NewSigner(kid string, seed []byte, extraPublic map[string]ed25519.PublicKey) (*Signer, error) {
	if kid == "" {
		return nil, errors.New("kid vazio")
	}
	if len(seed) != ed25519.SeedSize {
		return nil, fmt.Errorf("a semente da chave deve ter %d bytes, veio com %d", ed25519.SeedSize, len(seed))
	}
	priv := ed25519.NewKeyFromSeed(seed)
	verify := map[string]ed25519.PublicKey{kid: priv.Public().(ed25519.PublicKey)}
	for k, v := range extraPublic {
		if _, taken := verify[k]; !taken {
			verify[k] = v
		}
	}
	return &Signer{kid: kid, priv: priv, verify: verify}, nil
}

// GenerateSeed gera uma semente nova, codificada em base64 para a variável de ambiente.
func GenerateSeed() (string, error) {
	seed := make([]byte, ed25519.SeedSize)
	if _, err := rand.Read(seed); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(seed), nil
}

// Issue emite o token de acesso de uma sessão.
func (s *Signer) Issue(userID, sessionID uuid.UUID, now time.Time) (token string, expiresIn time.Duration, err error) {
	claims := Claims{
		SessionID: sessionID,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    Issuer,
			Audience:  jwt.ClaimStrings{Audience},
			Subject:   userID.String(),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(AccessTokenTTL)),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodEdDSA, claims)
	t.Header["kid"] = s.kid
	signed, err := t.SignedString(s.priv)
	return signed, AccessTokenTTL, err
}

// Parse valida assinatura, algoritmo, iss, aud e validade.
func (s *Signer) Parse(token string, now time.Time) (Claims, error) {
	var claims Claims
	_, err := jwt.ParseWithClaims(token, &claims, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		key, ok := s.verify[kid]
		if !ok {
			return nil, errors.New("kid desconhecido")
		}
		return key, nil
	},
		jwt.WithValidMethods([]string{jwt.SigningMethodEdDSA.Alg()}),
		jwt.WithIssuer(Issuer),
		jwt.WithAudience(Audience),
		jwt.WithTimeFunc(func() time.Time { return now }),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	)
	if errors.Is(err, jwt.ErrTokenExpired) {
		return Claims{}, fmt.Errorf("%w: %w", ErrInvalidToken, ErrTokenExpired)
	}
	if err != nil {
		return Claims{}, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}
	if _, err := claims.UserID(); err != nil || claims.SessionID == uuid.Nil {
		return Claims{}, ErrInvalidToken
	}
	return claims, nil
}

// NewRefreshToken gera o refresh token (32 bytes aleatórios, AUT-13) e o hash que vai
// para o banco. O valor em claro só existe no cookie do usuário.
func NewRefreshToken() (token string, hash []byte, err error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", nil, err
	}
	token = base64.RawURLEncoding.EncodeToString(b)
	return token, HashRefreshToken(token), nil
}

func HashRefreshToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// ParsePreviousKeys lê chaves públicas anteriores no formato "kid:base64".
func ParsePreviousKeys(entries []string) (map[string]ed25519.PublicKey, error) {
	keys := make(map[string]ed25519.PublicKey, len(entries))
	for _, e := range entries {
		kid, b64, ok := strings.Cut(e, ":")
		if !ok || kid == "" {
			return nil, fmt.Errorf("chave anterior %q fora do formato kid:base64", e)
		}
		raw, err := base64.StdEncoding.DecodeString(b64)
		if err != nil || len(raw) != ed25519.PublicKeySize {
			return nil, fmt.Errorf("chave pública de %q inválida", kid)
		}
		keys[kid] = ed25519.PublicKey(raw)
	}
	return keys, nil
}

// PublicKeyEntry devolve a chave pública do Signer no formato aceito por ParsePreviousKeys,
// para guardar na variável de ambiente antes de girar a chave.
func (s *Signer) PublicKeyEntry() string {
	return s.kid + ":" + base64.StdEncoding.EncodeToString(s.verify[s.kid])
}

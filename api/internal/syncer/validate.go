package syncer

import (
	"encoding/json"
	"math/big"
	"regexp"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
)

const (
	maxMoneyCents = 99_999_999_999  // R$ 999.999.999,99 (CON-03, TRX-03)
	minDate       = "2000-01-01"    // TRX-06
	futureSlack   = 5 * time.Minute // GER-05
)

var (
	colorRe  = regexp.MustCompile(`^#[0-9A-Fa-f]{6}$`)
	iconRe   = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)
	tickerRe = regexp.MustCompile(`^[A-Z0-9.-]{1,12}$`)
	qtyRe    = regexp.MustCompile(`^[0-9]{1,19}(\.[0-9]{1,8})?$`)

	accountTypes = set("corrente", "poupanca", "carteira", "digital", "corretora", "cartao_credito")
	assetClasses = set("renda_fixa", "acoes", "fiis", "etfs", "cripto", "outros")
	themes       = set("light", "dark", "system")
)

func set(items ...string) map[string]bool {
	m := make(map[string]bool, len(items))
	for _, i := range items {
		m[i] = true
	}
	return m
}

// fieldCheck junta os erros de campo de uma operação (VALIDATION_FAILED, GER-10, GER-11).
type fieldCheck struct{ errs []httpx.FieldError }

func (f *fieldCheck) add(field, reason string) {
	f.errs = append(f.errs, httpx.FieldError{Field: field, Reason: reason})
}

func (f *fieldCheck) ok() bool { return len(f.errs) == 0 }

// cleanText aplica GER-10: sem espaços nas pontas e sem caracteres de controle.
// Quebras de linha só sobrevivem nos campos de várias linhas (observações).
func cleanText(s string, multiline bool) string {
	var b strings.Builder
	for _, r := range s {
		switch {
		case r == '\n' && multiline:
			b.WriteRune(r)
		case r == '\t' && multiline:
			b.WriteRune(' ')
		case unicode.IsControl(r):
		default:
			b.WriteRune(r)
		}
	}
	return strings.TrimSpace(b.String())
}

// required confere um texto obrigatório com limites em caracteres.
func (f *fieldCheck) required(field string, p *string, min, max int, multiline bool) string {
	if p == nil {
		f.add(field, "REQUIRED")
		return ""
	}
	s := cleanText(*p, multiline)
	switch n := utf8.RuneCountInString(s); {
	case n < min:
		if n == 0 {
			f.add(field, "REQUIRED")
		} else {
			f.add(field, "TOO_SHORT")
		}
	case n > max:
		f.add(field, "TOO_LONG")
	}
	return s
}

// optional confere um texto opcional; vazio vira nulo.
func (f *fieldCheck) optional(field string, p *string, max int, multiline bool) *string {
	if p == nil {
		return nil
	}
	s := cleanText(*p, multiline)
	if s == "" {
		return nil
	}
	if utf8.RuneCountInString(s) > max {
		f.add(field, "TOO_LONG")
	}
	return &s
}

func (f *fieldCheck) oneOf(field string, p *string, allowed map[string]bool) string {
	if p == nil {
		f.add(field, "REQUIRED")
		return ""
	}
	if !allowed[*p] {
		f.add(field, "INVALID_VALUE")
	}
	return *p
}

func (f *fieldCheck) color(field string, p *string) string {
	if p == nil {
		f.add(field, "REQUIRED")
		return ""
	}
	if !colorRe.MatchString(*p) {
		f.add(field, "INVALID_FORMAT")
	}
	return strings.ToUpper(*p)
}

func (f *fieldCheck) icon(field string, p *string, required bool) *string {
	if p == nil || *p == "" {
		if required {
			f.add(field, "REQUIRED")
		}
		return nil
	}
	// O catálogo fixo de ícones (GER-11) ainda não existe; por enquanto vale o formato das chaves.
	if len(*p) > 40 || !iconRe.MatchString(*p) {
		f.add(field, "INVALID_FORMAT")
	}
	return p
}

func (f *fieldCheck) money(field string, p *int64, min, max int64) int64 {
	if p == nil {
		f.add(field, "REQUIRED")
		return 0
	}
	if *p < min || *p > max {
		f.add(field, "OUT_OF_RANGE")
	}
	return *p
}

func (f *fieldCheck) boolean(field string, p *bool) bool {
	if p == nil {
		f.add(field, "REQUIRED")
		return false
	}
	return *p
}

func (f *fieldCheck) sortOrder(field string, p *int64) int32 {
	if p == nil {
		f.add(field, "REQUIRED")
		return 0
	}
	if *p < -1_000_000 || *p > 1_000_000 {
		f.add(field, "OUT_OF_RANGE")
	}
	return int32(*p) //nolint:gosec // limitado a ±1.000.000 acima
}

func (f *fieldCheck) id(field string, p *uuid.UUID) uuid.UUID {
	if p == nil || *p == uuid.Nil {
		f.add(field, "REQUIRED")
		return uuid.Nil
	}
	return *p
}

// date confere uma data de calendário entre 01/01/2000 e hoje + 2 anos (TRX-06).
func (f *fieldCheck) date(field string, p *string, today time.Time) time.Time {
	if p == nil {
		f.add(field, "REQUIRED")
		return time.Time{}
	}
	d, err := time.Parse(dateLayout, *p)
	if err != nil {
		f.add(field, "INVALID_FORMAT")
		return time.Time{}
	}
	lo, _ := time.Parse(dateLayout, minDate)
	if d.Before(lo) || d.After(today.AddDate(2, 0, 1)) {
		f.add(field, "OUT_OF_RANGE")
	}
	return d
}

func (f *fieldCheck) instantRequired(field string, p *time.Time) time.Time {
	if p == nil || p.IsZero() {
		f.add(field, "REQUIRED")
		return time.Time{}
	}
	return p.UTC().Truncate(time.Microsecond)
}

// quantity aceita número ou texto decimal positivo com até 8 casas (INV-10).
func (f *fieldCheck) quantity(field string, raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		f.add(field, "REQUIRED")
		return ""
	}
	s := strings.Trim(string(raw), `"`)
	if !qtyRe.MatchString(s) {
		f.add(field, "INVALID_FORMAT")
		return ""
	}
	if r, ok := new(big.Rat).SetString(s); !ok || r.Sign() <= 0 {
		f.add(field, "OUT_OF_RANGE")
		return ""
	}
	return s
}

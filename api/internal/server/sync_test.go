package server

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/gsmunizz/prumoweb/api/internal/database"
	"github.com/gsmunizz/prumoweb/api/internal/syncer"
)

// Testes de integração do sync (SYN-*) e das regras de registro (GER-*, CON-*, CAT-*, TRX-*, INV-*).

type opSpec struct {
	entity string
	id     uuid.UUID
	at     time.Time
	data   map[string]any
}

type result map[string]any

func (r result) status() string { s, _ := r["status"].(string); return s }
func (r result) code() string   { s, _ := r["code"].(string); return s }
func (r result) current() map[string]any {
	c, _ := r["current"].(map[string]any)
	return c
}

func (e *env) push(a *account, ops ...opSpec) []result {
	e.t.Helper()
	r := e.pushRaw(a, ops...)
	if r.Code != http.StatusOK {
		e.t.Fatalf("push: %d %s", r.Code, r.Body)
	}
	raw, _ := r.json()["results"].([]any)
	out := make([]result, len(raw))
	for i, x := range raw {
		out[i], _ = x.(map[string]any)
	}
	if len(out) != len(ops) {
		e.t.Fatalf("resultados = %d, esperava %d", len(out), len(ops))
	}
	return out
}

func (e *env) pushRaw(a *account, ops ...opSpec) resp {
	list := make([]map[string]any, len(ops))
	for i, o := range ops {
		list[i] = map[string]any{"op_id": uuid.NewString(), "entity": o.entity, "id": o.id, "updated_at": o.at.UTC().Format(time.RFC3339Nano), "data": o.data}
	}
	return e.do("POST", "/sync/push", map[string]any{"device_id": "aparelho-1", "ops": list}, bearer(a.access))
}

func (e *env) pull(a *account, since int64, limit int) map[string]any {
	e.t.Helper()
	r := e.do("GET", fmt.Sprintf("/sync/pull?since=%d&limit=%d", since, limit), nil, bearer(a.access))
	if r.Code != http.StatusOK {
		e.t.Fatalf("pull: %d %s", r.Code, r.Body)
	}
	return r.json()
}

func records(pull map[string]any, entity string) []map[string]any {
	changes, _ := pull["changes"].(map[string]any)
	raw, _ := changes[entity].([]any)
	out := make([]map[string]any, len(raw))
	for i, x := range raw {
		out[i], _ = x.(map[string]any)
	}
	return out
}

func findRecord(pull map[string]any, entity string, id uuid.UUID) map[string]any {
	for _, r := range records(pull, entity) {
		if r["id"] == id.String() {
			return r
		}
	}
	return nil
}

func (e *env) firstOf(a *account, entity, typ string) uuid.UUID {
	e.t.Helper()
	for _, r := range records(e.pull(a, 0, 1000), entity) {
		if typ == "" || r["type"] == typ {
			id, _ := uuid.Parse(r["id"].(string))
			return id
		}
	}
	e.t.Fatalf("sem %s %s", entity, typ)
	return uuid.Nil
}

func (e *env) at(d time.Duration) time.Time { return e.now().Add(d) }

func acctOp(e *env, id uuid.UUID, name string, at time.Time, extra map[string]any) opSpec {
	d := map[string]any{"name": name, "type": "corrente", "initial_balance_cents": 1000, "color": "#112233", "archived": false, "sort_order": 1, "created_at": at}
	for k, v := range extra {
		d[k] = v
	}
	return opSpec{"accounts", id, at, d}
}

func catOp(id uuid.UUID, name, typ string, at time.Time, extra map[string]any) opSpec {
	d := map[string]any{"name": name, "type": typ, "icon": "tag", "color": "#445566", "sort_order": 1, "created_at": at}
	for k, v := range extra {
		d[k] = v
	}
	return opSpec{"categories", id, at, d}
}

func (e *env) txOp(id uuid.UUID, typ string, cents int64, account uuid.UUID, category *uuid.UUID, at time.Time, extra map[string]any) opSpec {
	d := map[string]any{"type": typ, "amount_cents": cents, "date": at.Format("2006-01-02"), "account_id": account, "created_at": at}
	if category != nil {
		d["category_id"] = *category
	}
	for k, v := range extra {
		d[k] = v
	}
	return opSpec{"transactions", id, at, d}
}

func ptr[T any](v T) *T { return &v }

func wantStatus(t *testing.T, name string, r result, status, code string) {
	t.Helper()
	if r.status() != status || r.code() != code {
		t.Errorf("%s: status=%q code=%q, esperava %q %q (%v)", name, r.status(), r.code(), status, code, r)
	}
}

func TestPullFirstSyncAndPaging(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")

	p := e.pull(a, 0, 1000)
	if got := len(records(p, "profile")); got != 1 {
		t.Errorf("perfil = %d", got)
	}
	if got := len(records(p, "categories")); got != 18 {
		t.Errorf("categorias = %d", got)
	}
	if got := len(records(p, "accounts")); got != 1 {
		t.Errorf("contas = %d", got)
	}
	for _, k := range []string{"transactions", "investments", "investment_movements", "investment_snapshots"} {
		if _, ok := p["changes"].(map[string]any)[k].([]any); !ok {
			t.Errorf("changes sem a chave %s", k)
		}
	}
	if p["has_more"] != false {
		t.Errorf("has_more = %v", p["has_more"])
	}

	// Páginas pequenas percorrem tudo, sem repetir nem pular registro.
	seen := map[string]bool{}
	var since int64
	for pages := 0; pages < 100; pages++ {
		page := e.pull(a, since, 5)
		count := 0
		for _, ent := range []string{"profile", "accounts", "categories"} {
			for _, r := range records(page, ent) {
				count++
				id := r["id"].(string)
				if seen[id] {
					t.Fatalf("registro repetido: %s", id)
				}
				seen[id] = true
			}
		}
		if count > 5 {
			t.Fatalf("página com %d registros", count)
		}
		since = int64(page["next_since"].(float64))
		if page["has_more"] != true {
			break
		}
	}
	if len(seen) != 20 {
		t.Errorf("registros vistos = %d, esperava 20", len(seen))
	}
	if next := int64(e.pull(a, since, 1000)["next_since"].(float64)); next != since {
		t.Errorf("sem mudanças o cursor deveria ficar em %d, veio %d", since, next)
	}
}

func TestPushLastWriteWinsAndIdempotence(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	id := uuid.New()
	t0 := e.at(-time.Hour)

	r := e.push(a, acctOp(e, id, "Nubank", t0, nil))
	wantStatus(t, "criar", r[0], "applied", "")
	// SYN-06: reenviar o mesmo lote não duplica e devolve o registro atual.
	r = e.push(a, acctOp(e, id, "Nubank", t0, nil))
	wantStatus(t, "reenvio", r[0], "stale", "")
	if r[0].current()["name"] != "Nubank" || r[0].current()["server_version"] == nil {
		t.Errorf("current = %v", r[0].current())
	}
	// Empate fica com o servidor; mais antigo perde; mais novo vence (GER-04).
	wantStatus(t, "empate", e.push(a, acctOp(e, id, "Empate", t0, nil))[0], "stale", "")
	wantStatus(t, "antigo", e.push(a, acctOp(e, id, "Antigo", t0.Add(-time.Minute), nil))[0], "stale", "")
	wantStatus(t, "novo", e.push(a, acctOp(e, id, "Itaú", t0.Add(time.Minute), nil))[0], "applied", "")
	p := e.pull(a, 0, 1000)
	if rec := findRecord(p, "accounts", id); rec["name"] != "Itaú" || rec["created_at"] != t0.UTC().Format("2006-01-02T15:04:05.000Z") {
		t.Errorf("registro = %v (created_at deve ficar o do primeiro envio)", rec)
	}
	// Uma só linha.
	n := 0
	for _, r := range records(p, "accounts") {
		if r["id"] == id.String() {
			n++
		}
	}
	if n != 1 {
		t.Errorf("linhas = %d", n)
	}
}

func TestPushFutureClockIsClamped(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	id := uuid.New()
	// GER-05: relógio uma hora adiantado vira a hora do servidor.
	wantStatus(t, "criar", e.push(a, acctOp(e, id, "Futuro", e.at(time.Hour), nil))[0], "applied", "")
	stored := findRecord(e.pull(a, 0, 1000), "accounts", id)["updated_at"].(string)
	got, _ := time.Parse(time.RFC3339Nano, stored)
	if got.After(e.now().Add(time.Second)) {
		t.Fatalf("updated_at guardado = %s, deveria ser no máximo a hora do servidor", stored)
	}
	// Dentro da tolerância de 5 minutos, vale o que o aparelho mandou.
	id2 := uuid.New()
	soon := e.at(4 * time.Minute)
	e.push(a, acctOp(e, id2, "Quase", soon, nil))
	stored = findRecord(e.pull(a, 0, 1000), "accounts", id2)["updated_at"].(string)
	if got, _ = time.Parse(time.RFC3339Nano, stored); got.Sub(soon).Abs() > time.Millisecond {
		t.Errorf("updated_at = %s, esperava %s", stored, soon.UTC().Format(time.RFC3339Nano))
	}
}

func TestPushValidation(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	acc := e.firstOf(a, "accounts", "")
	exp := e.firstOf(a, "categories", "expense")
	inc := e.firstOf(a, "categories", "income")
	now := e.now()

	cases := []struct {
		name string
		op   opSpec
		code string
	}{
		{"valor zero", e.txOp(uuid.New(), "expense", 0, acc, &exp, now, nil), "VALIDATION_FAILED"},
		{"valor acima do limite", e.txOp(uuid.New(), "expense", 100_000_000_000, acc, &exp, now, nil), "VALIDATION_FAILED"},
		{"data antes de 2000", e.txOp(uuid.New(), "expense", 100, acc, &exp, now, map[string]any{"date": "1999-12-31"}), "VALIDATION_FAILED"},
		{"data longe no futuro", e.txOp(uuid.New(), "expense", 100, acc, &exp, now, map[string]any{"date": now.AddDate(3, 0, 0).Format("2006-01-02")}), "VALIDATION_FAILED"},
		{"descrição longa", e.txOp(uuid.New(), "expense", 100, acc, &exp, now, map[string]any{"description": strings.Repeat("a", 141)}), "VALIDATION_FAILED"},
		{"sem categoria", e.txOp(uuid.New(), "expense", 100, acc, nil, now, nil), "VALIDATION_FAILED"},
		{"categoria do outro tipo", e.txOp(uuid.New(), "expense", 100, acc, &inc, now, nil), "CATEGORY_TYPE_MISMATCH"},
		{"conta inexistente", e.txOp(uuid.New(), "expense", 100, uuid.New(), &exp, now, nil), "REFERENCE_NOT_FOUND"},
		{"categoria inexistente", e.txOp(uuid.New(), "expense", 100, acc, ptr(uuid.New()), now, nil), "REFERENCE_NOT_FOUND"},
		{"conta sem nome", acctOp(e, uuid.New(), "   ", now, nil), "VALIDATION_FAILED"},
		{"conta com cor ruim", acctOp(e, uuid.New(), "X", now, map[string]any{"color": "azul"}), "VALIDATION_FAILED"},
		{"conta com tipo ruim", acctOp(e, uuid.New(), "X", now, map[string]any{"type": "cheque"}), "VALIDATION_FAILED"},
		{"saldo acima do limite", acctOp(e, uuid.New(), "X", now, map[string]any{"initial_balance_cents": 100_000_000_000}), "VALIDATION_FAILED"},
		{"conta sem arquivada", opSpec{"accounts", uuid.New(), now, map[string]any{"name": "X", "type": "corrente", "initial_balance_cents": 0, "color": "#112233", "sort_order": 1, "created_at": now}}, "VALIDATION_FAILED"},
		{"categoria com nome longo", catOp(uuid.New(), strings.Repeat("a", 31), "expense", now, nil), "VALIDATION_FAILED"},
		{"transferência com categoria", e.txOp(uuid.New(), "expense", 100, acc, &exp, now, map[string]any{"transfer_id": uuid.New()}), "TRANSFER_INVALID"},
	}
	ops := make([]opSpec, len(cases))
	for i, c := range cases {
		ops[i] = c.op
	}
	for i, r := range e.push(a, ops...) {
		wantStatus(t, cases[i].name, r, "rejected", cases[i].code)
	}

	// GER-10: espaços e caracteres de controle saem; HTML fica como texto.
	id := uuid.New()
	wantStatus(t, "texto sujo", e.push(a, e.txOp(id, "expense", 100, acc, &exp, now, map[string]any{
		"description": "  Caf\u0000é <b>forte</b>\u0007  ", "notes": " linha 1\nlinha\t2 ",
	}))[0], "applied", "")
	rec := findRecord(e.pull(a, 0, 1000), "transactions", id)
	if rec["description"] != "Café <b>forte</b>" || rec["notes"] != "linha 1\nlinha 2" {
		t.Errorf("texto gravado = %q / %q", rec["description"], rec["notes"])
	}
	// GER-02: user_id no corpo é ignorado.
	id2 := uuid.New()
	wantStatus(t, "user_id no corpo", e.push(a, e.txOp(id2, "expense", 100, acc, &exp, now, map[string]any{"user_id": uuid.NewString()}))[0], "applied", "")
	if findRecord(e.pull(a, 0, 1000), "transactions", id2) == nil {
		t.Error("transação não apareceu para o dono")
	}
}

func TestPushBatchLimitsAndShape(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	acc := e.firstOf(a, "accounts", "")
	exp := e.firstOf(a, "categories", "expense")

	many := make([]opSpec, syncer.MaxOps+1)
	for i := range many {
		many[i] = e.txOp(uuid.New(), "expense", 100, acc, &exp, e.now(), nil)
	}
	if r := e.pushRaw(a, many...); r.Code != 413 || r.errCode() != "PAYLOAD_TOO_LARGE" {
		t.Errorf("501 operações: %d %s", r.Code, r.errCode())
	}
	if r := e.pushRaw(a, many[:syncer.MaxOps]...); r.Code != 200 {
		t.Errorf("500 operações: %d %s", r.Code, r.Body)
	}
	if r := e.pushRaw(a, opSpec{"foguetes", uuid.New(), e.now(), map[string]any{"x": 1}}); r.Code != 422 || r.errCode() != "VALIDATION_FAILED" {
		t.Errorf("entidade desconhecida: %d %s", r.Code, r.errCode())
	}
	if r := e.do("POST", "/sync/push", map[string]any{"ops": []any{}}, bearer(a.access)); r.Code != 422 {
		t.Errorf("sem device_id: %d", r.Code)
	}
	dup := uuid.NewString()
	op := map[string]any{"op_id": dup, "entity": "accounts", "id": uuid.New(), "updated_at": e.now(), "data": map[string]any{}}
	if r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{op, op}}, bearer(a.access)); r.Code != 422 {
		t.Errorf("op_id repetido: %d", r.Code)
	}
	big := strings.NewReader(`{"device_id":"x","ops":[],"pad":"` + strings.Repeat("a", 5<<20) + `"}`)
	r := e.do("POST", "/sync/push", nil, bearer(a.access), func(req *http.Request) { req.Body = http.NoBody; req.Body = readCloser{big}; req.ContentLength = -1 })
	if r.Code != 413 {
		t.Errorf("corpo de 5 MB+: %d", r.Code)
	}
	if r := e.do("POST", "/sync/push", nil, bearer(a.access)); r.Code != 400 {
		t.Errorf("sem corpo: %d", r.Code)
	}
	if r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{}}); r.Code != 401 {
		t.Errorf("sem token: %d", r.Code)
	}
}

type readCloser struct{ *strings.Reader }

func (readCloser) Close() error { return nil }

func TestPushRateLimit(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	for i := 0; i < 60; i++ {
		if r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{}}, bearer(a.access)); r.Code != 200 {
			t.Fatalf("push %d: %d", i, r.Code)
		}
	}
	r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{}}, bearer(a.access))
	if r.Code != 429 || r.Header().Get("Retry-After") == "" {
		t.Fatalf("61º push: %d", r.Code)
	}
	// O limite é por usuário, e a janela passa.
	b := e.register("Bia")
	if r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{}}, bearer(b.access)); r.Code != 200 {
		t.Errorf("outro usuário: %d", r.Code)
	}
	e.advance(61 * time.Second)
	a2 := e.do("POST", "/auth/login", map[string]any{"email": a.email, "password": a.password}, fromIP("203.0.113.90"))
	if r := e.do("POST", "/sync/push", map[string]any{"device_id": "x", "ops": []any{}}, bearer(a2.json()["access_token"].(string))); r.Code != 200 {
		t.Errorf("depois da janela: %d", r.Code)
	}
}

func TestSyncIsolatesUsers(t *testing.T) {
	e := newEnv(t, "open")
	a, b := e.register("Ana"), e.register("Bia")
	accA := e.firstOf(a, "accounts", "")
	catB := e.firstOf(b, "categories", "expense")

	// GER-03: um id de outro usuário responde NOT_FOUND, sem revelar que existe.
	wantStatus(t, "id de outro usuário", e.push(b, acctOp(e, accA, "Roubada", e.now(), nil))[0], "rejected", "NOT_FOUND")
	if rec := findRecord(e.pull(a, 0, 1000), "accounts", accA); rec["name"] == "Roubada" {
		t.Error("conta de Ana foi alterada por Bia")
	}
	// GER-09: referência a registro de outro usuário.
	wantStatus(t, "conta de outro", e.push(b, e.txOp(uuid.New(), "expense", 100, accA, &catB, e.now(), nil))[0], "rejected", "REFERENCE_NOT_FOUND")
	for _, ent := range []string{"accounts", "categories", "transactions"} {
		for _, r := range records(e.pull(b, 0, 1000), ent) {
			if r["id"] == accA.String() {
				t.Errorf("Bia enxergou %s de Ana", ent)
			}
		}
	}
	// O perfil de outro usuário também não se edita: o id tem de ser o próprio.
	prof := opSpec{"profile", a.userID, e.now(), map[string]any{"name": "Invasor", "currency": "BRL", "timezone": "America/Sao_Paulo", "theme": "dark"}}
	wantStatus(t, "perfil de outro", e.push(b, prof)[0], "rejected", "VALIDATION_FAILED")
}

func TestProfileSync(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	data := func(extra map[string]any) map[string]any {
		d := map[string]any{"name": "Ana Souza", "currency": "BRL", "timezone": "America/Fortaleza", "theme": "dark"}
		for k, v := range extra {
			d[k] = v
		}
		return d
	}
	at := e.at(time.Minute)
	wantStatus(t, "atualizar", e.push(a, opSpec{"profile", a.userID, at, data(nil)})[0], "applied", "")
	rec := records(e.pull(a, 0, 1000), "profile")[0]
	if rec["name"] != "Ana Souza" || rec["timezone"] != "America/Fortaleza" || rec["theme"] == "system" {
		t.Errorf("perfil = %v", rec)
	}
	wantStatus(t, "perfil antigo", e.push(a, opSpec{"profile", a.userID, e.at(-time.Hour), data(map[string]any{"name": "Velho"})})[0], "stale", "")
	for name, extra := range map[string]map[string]any{
		"fuso inválido": {"timezone": "Marte/Olimpo"}, "moeda": {"currency": "USD"}, "tema": {"theme": "neon"},
		"nome vazio": {"name": " "}, "excluir": {"deleted_at": e.now()},
	} {
		wantStatus(t, name, e.push(a, opSpec{"profile", a.userID, e.at(time.Hour), data(extra)})[0], "rejected", "VALIDATION_FAILED")
	}
}

func TestTransfers(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	from := e.firstOf(a, "accounts", "")
	to := uuid.New()
	e.push(a, acctOp(e, to, "Poupança", e.now(), nil))
	now := e.now()
	half := func(id, tid uuid.UUID, typ string, cents int64, acc uuid.UUID, extra map[string]any) opSpec {
		d := map[string]any{"transfer_id": tid}
		for k, v := range extra {
			d[k] = v
		}
		return e.txOp(id, typ, cents, acc, nil, now, d)
	}

	// TRX-12: as duas metades no mesmo lote.
	tid, out, in := uuid.New(), uuid.New(), uuid.New()
	r := e.push(a, half(out, tid, "expense", 5000, from, nil), half(in, tid, "income", 5000, to, nil))
	wantStatus(t, "par válido (saída)", r[0], "applied", "")
	wantStatus(t, "par válido (entrada)", r[1], "applied", "")

	// Meia transferência é recusada, e uma operação comum do mesmo lote segue (SYN-04).
	exp := e.firstOf(a, "categories", "expense")
	ok := e.txOp(uuid.New(), "expense", 100, from, &exp, now, nil)
	r = e.push(a, half(uuid.New(), uuid.New(), "expense", 100, from, nil), ok)
	wantStatus(t, "meia transferência", r[0], "rejected", "TRANSFER_INCOMPLETE")
	wantStatus(t, "operação comum no mesmo lote", r[1], "applied", "")

	// Valores diferentes, contas iguais, mesmo tipo: as duas recusadas (SYN-05).
	t2 := uuid.New()
	r = e.push(a, half(uuid.New(), t2, "expense", 100, from, nil), half(uuid.New(), t2, "income", 200, to, nil))
	wantStatus(t, "valores diferentes (a)", r[0], "rejected", "TRANSFER_INVALID")
	wantStatus(t, "valores diferentes (b)", r[1], "rejected", "TRANSFER_INVALID")
	t3 := uuid.New()
	r = e.push(a, half(uuid.New(), t3, "expense", 100, from, nil), half(uuid.New(), t3, "income", 100, from, nil))
	wantStatus(t, "mesma conta", r[0], "rejected", "TRANSFER_SAME_ACCOUNT")
	t4 := uuid.New()
	r = e.push(a, half(uuid.New(), t4, "expense", 100, from, nil), half(uuid.New(), t4, "expense", 100, to, nil))
	wantStatus(t, "dois do mesmo tipo", r[0], "rejected", "TRANSFER_INVALID")
	// Nada disso ficou no banco.
	for _, rec := range records(e.pull(a, 0, 1000), "transactions") {
		if tr := rec["transfer_id"]; tr != nil && tr != tid.String() {
			t.Errorf("transferência inválida gravada: %v", rec)
		}
	}

	// Editar só uma metade quebra o par; editar as duas junto vale.
	later := now.Add(time.Minute)
	editOut := half(out, tid, "expense", 7000, from, map[string]any{"date": later.Format("2006-01-02")})
	editOut.at = later
	wantStatus(t, "editar uma metade", e.push(a, editOut)[0], "rejected", "TRANSFER_INVALID")
	editIn := half(in, tid, "income", 7000, to, nil)
	editIn.at = later
	editOut = half(out, tid, "expense", 7000, from, nil)
	editOut.at = later
	r = e.push(a, editOut, editIn)
	wantStatus(t, "editar as duas (a)", r[0], "applied", "")
	wantStatus(t, "editar as duas (b)", r[1], "applied", "")

	// Excluir só uma metade é recusado; as duas juntas valem.
	del := func(id uuid.UUID, typ string, acc uuid.UUID) opSpec {
		o := half(id, tid, typ, 7000, acc, map[string]any{"deleted_at": later.Add(time.Minute)})
		o.at = later.Add(time.Minute)
		return o
	}
	wantStatus(t, "excluir uma metade", e.push(a, del(out, "expense", from))[0], "rejected", "TRANSFER_INCOMPLETE")
	r = e.push(a, del(out, "expense", from), del(in, "income", to))
	wantStatus(t, "excluir as duas (a)", r[0], "applied", "")
	wantStatus(t, "excluir as duas (b)", r[1], "applied", "")
}

func TestAccountAndCategoryDeletion(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	now := e.now()
	acc1, acc2 := uuid.New(), uuid.New()
	cat1, cat2 := uuid.New(), uuid.New()
	e.push(a, acctOp(e, acc1, "Conta 1", now, nil), acctOp(e, acc2, "Conta 2", now, nil),
		catOp(cat1, "Cat 1", "expense", now, nil), catOp(cat2, "Cat 2", "expense", now, nil))
	tx := uuid.New()
	wantStatus(t, "tx", e.push(a, e.txOp(tx, "expense", 100, acc1, &cat1, now, nil))[0], "applied", "")

	later := now.Add(time.Minute)
	delAcc := acctOp(e, acc1, "Conta 1", later, map[string]any{"deleted_at": later})
	delCat := catOp(cat1, "Cat 1", "expense", later, map[string]any{"deleted_at": later})
	// CON-11 e CAT-04: em uso, não exclui.
	r := e.push(a, delAcc, delCat)
	wantStatus(t, "conta em uso", r[0], "rejected", "ACCOUNT_IN_USE")
	wantStatus(t, "categoria em uso", r[1], "rejected", "CATEGORY_IN_USE")

	// SYN-03: mover a transação e depois excluir, no mesmo lote, funciona.
	move := e.txOp(tx, "expense", 100, acc2, &cat2, later, nil)
	r = e.push(a, move, delAcc, delCat)
	wantStatus(t, "mover", r[0], "applied", "")
	wantStatus(t, "excluir conta", r[1], "applied", "")
	wantStatus(t, "excluir categoria", r[2], "applied", "")

	// CAT-02: o tipo não muda.
	typeChange := catOp(cat2, "Cat 2", "income", later.Add(time.Minute), nil)
	wantStatus(t, "mudar tipo", e.push(a, typeChange)[0], "rejected", "CATEGORY_TYPE_IMMUTABLE")

	// Investimento ativo também segura a conta (CON-11).
	inv := uuid.New()
	acc3 := uuid.New()
	e.push(a, acctOp(e, acc3, "Corretora", now, map[string]any{"type": "corretora"}))
	wantStatus(t, "investimento", e.push(a, opSpec{"investments", inv, now, map[string]any{
		"name": "PETR4", "asset_class": "acoes", "ticker": "petr4", "account_id": acc3, "created_at": now}})[0], "applied", "")
	del3 := acctOp(e, acc3, "Corretora", later, map[string]any{"type": "corretora", "deleted_at": later})
	wantStatus(t, "conta com investimento", e.push(a, del3)[0], "rejected", "ACCOUNT_IN_USE")
	if rec := findRecord(e.pull(a, 0, 1000), "investments", inv); rec["ticker"] != "PETR4" {
		t.Errorf("ticker = %v", rec["ticker"])
	}
}

func TestRestoresDeletedParents(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	now := e.now()
	acc := uuid.New()
	cat := uuid.New()
	e.push(a, acctOp(e, acc, "Velha", now, nil), catOp(cat, "Antiga", "expense", now, nil))
	t1 := now.Add(time.Minute)
	e.push(a, acctOp(e, acc, "Velha", t1, map[string]any{"deleted_at": t1}), catOp(cat, "Antiga", "expense", t1, map[string]any{"deleted_at": t1}))
	before := int64(e.pull(a, 0, 1000)["next_since"].(float64))

	// Uma transação mais antiga que a exclusão, feita offline em outro aparelho, é atrasada para o pai: stale não restaura.
	staleTx := e.txOp(uuid.New(), "expense", 100, acc, &cat, t1.Add(time.Minute), nil)
	staleTx.at = t1.Add(time.Minute)
	staleID := staleTx.id

	// GER-08: a transação não é recusada; o servidor restaura os pais.
	r := e.push(a, staleTx)
	wantStatus(t, "transação para pais excluídos", r[0], "applied", "")
	p := e.pull(a, before, 1000)
	accRec, catRec := findRecord(p, "accounts", acc), findRecord(p, "categories", cat)
	if accRec == nil || accRec["deleted_at"] != nil || catRec == nil || catRec["deleted_at"] != nil {
		t.Fatalf("pais não foram restaurados e devolvidos no pull: %v / %v", accRec, catRec)
	}
	if findRecord(p, "transactions", staleID) == nil {
		t.Error("transação não veio no pull")
	}
	// O restaurado tem updated_at maior que o da exclusão, para o last-write-wins do cliente aceitá-lo.
	if accRec["updated_at"].(string) <= t1.UTC().Format("2006-01-02T15:04:05.000Z") {
		t.Errorf("updated_at do pai restaurado = %v", accRec["updated_at"])
	}

	// Uma operação perdedora (stale) não restaura nada.
	acc2 := uuid.New()
	e.push(a, acctOp(e, acc2, "Outra", now, nil))
	e.push(a, acctOp(e, acc2, "Outra", t1, map[string]any{"deleted_at": t1}))
	old := e.txOp(staleID, "expense", 100, acc2, &cat, now.Add(-time.Hour), nil)
	old.at = now.Add(-time.Hour)
	wantStatus(t, "stale", e.push(a, old)[0], "stale", "")
	if rec := findRecord(e.pull(a, 0, 1000), "accounts", acc2); rec["deleted_at"] == nil {
		t.Error("operação stale restaurou o pai")
	}
}

func TestInvestments(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	now := e.now()
	inv := uuid.New()
	e.push(a, opSpec{"investments", inv, now, map[string]any{"name": "Tesouro", "asset_class": "renda_fixa", "created_at": now}})
	mv := func(id uuid.UUID, typ string, qty any, date time.Time, extra map[string]any) opSpec {
		d := map[string]any{"investment_id": inv, "type": typ, "date": date.Format("2006-01-02"), "quantity": qty, "amount_cents": 10000, "created_at": now}
		for k, v := range extra {
			d[k] = v
		}
		return opSpec{"investment_movements", id, now, d}
	}
	day := func(n int) time.Time { return now.AddDate(0, 0, n) }

	m1, m2 := uuid.New(), uuid.New()
	r := e.push(a, mv(m1, "aporte", "10.5", day(-5), nil), mv(m2, "resgate", 4, day(-1), nil))
	wantStatus(t, "aporte", r[0], "applied", "")
	wantStatus(t, "resgate", r[1], "applied", "")
	p := e.pull(a, 0, 1000)
	if rec := findRecord(p, "investment_movements", m1); rec["quantity"] != "10.5" {
		t.Errorf("quantity = %v", rec["quantity"])
	}
	// INV-13: resgate maior que a posição, em qualquer data.
	wantStatus(t, "resgate demais", e.push(a, mv(uuid.New(), "resgate", "6.51", day(0), nil))[0], "rejected", "REDEMPTION_EXCEEDS_POSITION")
	wantStatus(t, "resgate antes do aporte", e.push(a, mv(uuid.New(), "resgate", 1, day(-10), nil))[0], "rejected", "REDEMPTION_EXCEEDS_POSITION")
	wantStatus(t, "resgate no limite", e.push(a, mv(uuid.New(), "resgate", "6.5", day(0), nil))[0], "applied", "")
	// Quantidade e valor inválidos.
	for name, extra := range map[string]map[string]any{
		"quantidade zero": {"quantity": 0}, "nove casas": {"quantity": "1.123456789"}, "valor zero": {"amount_cents": 0}, "tipo": {"type": "doacao"},
	} {
		wantStatus(t, name, e.push(a, mv(uuid.New(), "aporte", 1, day(0), extra))[0], "rejected", "VALIDATION_FAILED")
	}
	wantStatus(t, "ativo inexistente", e.push(a, mv(uuid.New(), "aporte", 1, day(0), map[string]any{"investment_id": uuid.New()}))[0], "rejected", "REFERENCE_NOT_FOUND")

	// INV-21: o id do snapshot é determinístico.
	date := day(-2).Format("2006-01-02")
	snap := func(id uuid.UUID, cents int64, at time.Time) opSpec {
		return opSpec{"investment_snapshots", id, at, map[string]any{"investment_id": inv, "date": date, "value_cents": cents, "created_at": at}}
	}
	good := syncer.SnapshotID(inv, date)
	wantStatus(t, "id aleatório", e.push(a, snap(uuid.New(), 100, now))[0], "rejected", "VALIDATION_FAILED")
	wantStatus(t, "snapshot", e.push(a, snap(good, 120000, now))[0], "applied", "")
	// Dois aparelhos no mesmo dia caem no mesmo registro; vence o updated_at maior.
	wantStatus(t, "snapshot mais novo", e.push(a, snap(good, 130000, now.Add(time.Minute)))[0], "applied", "")
	wantStatus(t, "snapshot mais velho", e.push(a, snap(good, 1, now.Add(-time.Minute)))[0], "stale", "")
	n := 0
	for _, r := range records(e.pull(a, 0, 1000), "investment_snapshots") {
		n++
		if r["value_cents"] != float64(130000) {
			t.Errorf("snapshot = %v", r)
		}
	}
	if n != 1 {
		t.Errorf("snapshots = %d", n)
	}

	// INV-06: excluir o ativo exclui movimentos e snapshots junto.
	later := now.Add(4 * time.Minute) // dentro da tolerância de 5 minutos (GER-05)
	del := opSpec{"investments", inv, later, map[string]any{"name": "Tesouro", "asset_class": "renda_fixa", "created_at": now, "deleted_at": later}}
	wantStatus(t, "excluir ativo", e.push(a, del)[0], "applied", "")
	p = e.pull(a, 0, 1000)
	for _, ent := range []string{"investment_movements", "investment_snapshots"} {
		for _, r := range records(p, ent) {
			if r["deleted_at"] == nil {
				t.Errorf("%s não foi excluído junto: %v", ent, r)
			}
		}
	}
}

func TestInvestmentMovementLinkedToAccount(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	now := e.now()
	acc := e.firstOf(a, "accounts", "")
	inv, m := uuid.New(), uuid.New()
	e.push(a, opSpec{"investments", inv, now, map[string]any{"name": "PETR4", "asset_class": "acoes", "created_at": now}})
	movement := func(deleted *time.Time, cents int64) opSpec {
		d := map[string]any{"investment_id": inv, "type": "aporte", "date": now.Format("2006-01-02"), "quantity": 10, "amount_cents": cents, "account_id": acc, "created_at": now}
		at := now
		if deleted != nil {
			d["deleted_at"] = *deleted
			at = *deleted
		}
		return opSpec{"investment_movements", m, at, d}
	}
	linked := func(id uuid.UUID, deleted *time.Time, cents int64) opSpec {
		d := map[string]any{"investment_movement_id": m}
		at := now
		if deleted != nil {
			d["deleted_at"] = *deleted
			at = *deleted
		}
		o := e.txOp(id, "expense", cents, acc, nil, now, d)
		o.at = at
		return o
	}

	// INV-15: o movimento com conta só vale com a transação interna correspondente.
	wantStatus(t, "movimento sozinho", e.push(a, movement(nil, 5000))[0], "rejected", "VALIDATION_FAILED")
	txID := uuid.New()
	r := e.push(a, movement(nil, 5000), linked(txID, nil, 5000))
	wantStatus(t, "movimento", r[0], "applied", "")
	wantStatus(t, "transação interna", r[1], "applied", "")
	// Valor divergente: as duas recusadas.
	later := now.Add(time.Minute)
	bad := movement(nil, 9000)
	bad.at = later
	badTx := linked(txID, nil, 5000)
	badTx.at = later
	r = e.push(a, bad, badTx)
	wantStatus(t, "valor divergente (movimento)", r[0], "rejected", "VALIDATION_FAILED")
	wantStatus(t, "valor divergente (transação)", r[1], "rejected", "VALIDATION_FAILED")
	// Excluir só o movimento deixa a transação órfã.
	d1 := later.Add(time.Minute)
	wantStatus(t, "excluir só o movimento", e.push(a, movement(&d1, 5000))[0], "rejected", "VALIDATION_FAILED")
	r = e.push(a, movement(&d1, 5000), linked(txID, &d1, 5000))
	wantStatus(t, "excluir os dois (movimento)", r[0], "applied", "")
	wantStatus(t, "excluir os dois (transação)", r[1], "applied", "")

	// INV-06: excluir o ativo mantém a transação de conta, porque o dinheiro saiu da conta.
	m2, tx2 := uuid.New(), uuid.New()
	later = now.Add(3 * time.Minute)
	mv2 := opSpec{"investment_movements", m2, later, map[string]any{"investment_id": inv, "type": "aporte", "date": now.Format("2006-01-02"), "quantity": 1, "amount_cents": 700, "account_id": acc, "created_at": later}}
	tr2 := e.txOp(tx2, "expense", 700, acc, nil, later, map[string]any{"investment_movement_id": m2})
	tr2.at = later
	r = e.push(a, mv2, tr2)
	wantStatus(t, "novo movimento", r[0], "applied", "")
	wantStatus(t, "nova transação interna", r[1], "applied", "")
	del := later.Add(time.Minute)
	wantStatus(t, "excluir o ativo", e.push(a, opSpec{"investments", inv, del, map[string]any{"name": "PETR4", "asset_class": "acoes", "created_at": now, "deleted_at": del}})[0], "applied", "")
	if rec := findRecord(e.pull(a, 0, 1000), "transactions", tx2); rec == nil || rec["deleted_at"] != nil {
		t.Errorf("a transação de conta deveria continuar: %v", rec)
	}
}

func TestServerVersionsAreUniqueAndIncreasing(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	acc := e.firstOf(a, "accounts", "")
	exp := e.firstOf(a, "categories", "expense")
	var wg sync.WaitGroup
	errs := make(chan string, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ops := make([]opSpec, 20)
			for j := range ops {
				ops[j] = e.txOp(uuid.New(), "expense", 100, acc, &exp, e.now(), nil)
			}
			r := e.pushRaw(a, ops...)
			if r.Code != 200 {
				errs <- fmt.Sprintf("push concorrente: %d %s", r.Code, r.Body)
			}
		}()
	}
	wg.Wait()
	close(errs)
	for msg := range errs {
		t.Error(msg)
	}
	seen := map[float64]bool{}
	for _, ent := range []string{"profile", "accounts", "categories", "transactions"} {
		for _, r := range records(e.pull(a, 0, 1000), ent) {
			v := r["server_version"].(float64)
			if seen[v] {
				t.Fatalf("server_version repetido: %v", v)
			}
			seen[v] = true
		}
	}
	if n := len(records(e.pull(a, 0, 1000), "transactions")); n != 160 {
		t.Errorf("transações = %d, esperava 160", n)
	}
}

func TestPullRequiresResetBeforePurge(t *testing.T) {
	ownerURL := os.Getenv("TEST_OWNER_DATABASE_URL")
	if ownerURL == "" {
		t.Skip("TEST_OWNER_DATABASE_URL não definida")
	}
	e := newEnv(t, "open")
	a := e.register("Ana")
	owner, err := database.Connect(context.Background(), ownerURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(owner.Close)
	set := func(v int64) {
		if _, err := owner.Exec(context.Background(), `UPDATE sync_state SET purged_through = $1`, v); err != nil {
			t.Fatal(err)
		}
	}
	set(1_000_000_000)
	t.Cleanup(func() { set(0) })

	// SYN-09: cursor anterior à limpeza pede recomeço; since=0 e cursor atual seguem normais.
	r := e.do("GET", "/sync/pull?since=5", nil, bearer(a.access))
	if r.Code != 410 || r.errCode() != "SYNC_RESET_REQUIRED" {
		t.Errorf("cursor antigo: %d %s", r.Code, r.errCode())
	}
	if r := e.do("GET", "/sync/pull?since=0", nil, bearer(a.access)); r.Code != 200 {
		t.Errorf("since=0: %d", r.Code)
	}
	if r := e.do("GET", "/sync/pull?since=1000000000", nil, bearer(a.access)); r.Code != 200 {
		t.Errorf("cursor no limite: %d", r.Code)
	}
}

func TestPullParamsAreValidated(t *testing.T) {
	e := newEnv(t, "open")
	a := e.register("Ana")
	for _, q := range []string{"since=-1", "since=abc", "limit=0", "limit=1001", "limit=x"} {
		if r := e.do("GET", "/sync/pull?"+q, nil, bearer(a.access)); r.Code != 422 {
			t.Errorf("%s: %d", q, r.Code)
		}
	}
	if r := e.do("GET", "/sync/pull", nil); r.Code != 401 {
		t.Errorf("sem token: %d", r.Code)
	}
}

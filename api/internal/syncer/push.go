package syncer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/gsmunizz/prumoweb/api/internal/database"
	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

// Op é uma operação do push (SYN-02). data traz o registro inteiro; excluir é a mesma
// operação com deleted_at preenchido.
type Op struct {
	OpID      uuid.UUID       `json:"op_id"`
	Entity    string          `json:"entity"`
	ID        uuid.UUID       `json:"id"`
	UpdatedAt time.Time       `json:"updated_at"`
	Data      json.RawMessage `json:"data"`
}

type PushRequest struct {
	DeviceID string `json:"device_id"`
	Ops      []Op   `json:"ops"`
}

// Result é o desfecho de uma operação (SYN-04).
type Result struct {
	OpID    uuid.UUID `json:"op_id"`
	Status  string    `json:"status"`
	Code    string    `json:"code,omitempty"`
	Details any       `json:"details,omitempty"`
	Current any       `json:"current,omitempty"`
}

type PushResponse struct {
	Results    []Result `json:"results"`
	ServerTime string   `json:"server_time"`
}

// rejection é uma recusa de operação: um code do catálogo de erros e, opcionalmente, detalhes.
type rejection struct {
	code    string
	details any
}

func reject(code string, fields ...httpx.FieldError) *rejection {
	r := &rejection{code: code}
	if len(fields) > 0 {
		r.details = fields
	}
	return r
}

func validationFailed(errs []httpx.FieldError) *rejection {
	return &rejection{code: "VALIDATION_FAILED", details: errs}
}

// outcome é o que aplicar uma operação produziu. Exatamente um entre rej, stale e applied.
type outcome struct {
	err     error // falha interna: aborta o lote
	rej     *rejection
	stale   any // registro atual do servidor
	applied bool
	fx      effects
}

// effects diz o que a operação aplicada tocou, para as checagens de fim de lote (SYN-05).
type effects struct {
	transfers       []uuid.UUID
	movements       []uuid.UUID
	investments     []uuid.UUID // investimentos cuja posição pode ter mudado
	deletedAccount  *uuid.UUID
	deletedCategory *uuid.UUID
}

// violation é uma regra multi-registro quebrada ao fim do lote; ops são os índices das
// operações do lote envolvidas, que viram todas rejected (SYN-05).
type violation struct {
	rejection
	ops []int
}

var errRollback = errors.New("lote desfeito para recusar operações")

// Push aplica o lote (SYN-03) e devolve um resultado por operação, na mesma ordem.
func (s *Service) Push(ctx context.Context, userID uuid.UUID, req PushRequest) (PushResponse, error) {
	if err := validateBatch(req); err != nil {
		return PushResponse{}, err
	}
	forced := map[int]rejection{}
	for attempt := 0; attempt < maxAttempts; attempt++ {
		results, viols, err := s.runBatch(ctx, userID, req.Ops, forced)
		if err != nil {
			return PushResponse{}, err
		}
		if len(viols) == 0 {
			return PushResponse{Results: results, ServerTime: instantNow(s.now())}, nil
		}
		// Recusa as operações envolvidas e refaz o lote sem elas: as demais seguem valendo (SYN-04).
		added := false
		for _, v := range viols {
			for _, idx := range v.ops {
				if _, done := forced[idx]; !done {
					forced[idx] = v.rejection
					added = true
				}
			}
		}
		if !added {
			break
		}
	}
	return PushResponse{}, fmt.Errorf("sync: lote não estabilizou")
}

func validateBatch(req PushRequest) error {
	var errs []httpx.FieldError
	if len(req.Ops) > MaxOps {
		return ErrTooManyOps
	}
	if req.DeviceID == "" || len(req.DeviceID) > 64 {
		errs = append(errs, httpx.FieldError{Field: "device_id", Reason: "INVALID_VALUE"})
	}
	seen := make(map[uuid.UUID]bool, len(req.Ops))
	for i, op := range req.Ops {
		field := func(name string) string { return fmt.Sprintf("ops[%d].%s", i, name) }
		if op.OpID == uuid.Nil || seen[op.OpID] {
			errs = append(errs, httpx.FieldError{Field: field("op_id"), Reason: "INVALID_VALUE"})
		}
		seen[op.OpID] = true
		if !knownEntity(op.Entity) {
			errs = append(errs, httpx.FieldError{Field: field("entity"), Reason: "INVALID_VALUE"})
		}
		if op.ID == uuid.Nil {
			errs = append(errs, httpx.FieldError{Field: field("id"), Reason: "REQUIRED"})
		}
		if op.UpdatedAt.IsZero() {
			errs = append(errs, httpx.FieldError{Field: field("updated_at"), Reason: "REQUIRED"})
		}
		if len(op.Data) == 0 || string(op.Data) == "null" {
			errs = append(errs, httpx.FieldError{Field: field("data"), Reason: "REQUIRED"})
		}
	}
	if len(errs) > 0 {
		return httpx.ValidationFailed(errs...)
	}
	return nil
}

func (s *Service) runBatch(ctx context.Context, userID uuid.UUID, ops []Op, forced map[int]rejection) ([]Result, []violation, error) {
	results := make([]Result, len(ops))
	var viols []violation
	err := database.WithUser(ctx, s.app, userID, func(tx pgx.Tx) error {
		if err := lockUser(ctx, tx, userID); err != nil {
			return err
		}
		b := &batch{tx: tx, userID: userID, now: s.now().UTC(), fx: map[string]map[uuid.UUID][]int{}}
		b.today = b.now.Truncate(24 * time.Hour)
		for i, op := range ops {
			if r, ok := forced[i]; ok {
				results[i] = Result{OpID: op.OpID, Status: resultRejected, Code: r.code, Details: r.details}
				continue
			}
			res, err := b.applyOne(ctx, i, op)
			if err != nil {
				return err
			}
			results[i] = res
		}
		var err error
		if viols, err = b.check(ctx); err != nil {
			return err
		}
		if len(viols) > 0 {
			return errRollback
		}
		return nil
	})
	if errors.Is(err, errRollback) {
		err = nil
	}
	return results, viols, err
}

// batch guarda o estado de uma tentativa de aplicar o lote.
type batch struct {
	tx     pgx.Tx
	userID uuid.UUID
	now    time.Time
	today  time.Time
	// fx: tipo de registro → id → índices das operações aplicadas que o tocaram.
	fx map[string]map[uuid.UUID][]int
}

const (
	fxTransfer    = "transfer"
	fxMovement    = "movement"
	fxInvestment  = "investment"
	fxAccountDel  = "account_deleted"
	fxCategoryDel = "category_deleted"
)

func (b *batch) note(kind string, id uuid.UUID, opIdx int) {
	if b.fx[kind] == nil {
		b.fx[kind] = map[uuid.UUID][]int{}
	}
	b.fx[kind][id] = append(b.fx[kind][id], opIdx)
}

// applyOne aplica uma operação dentro de um savepoint, para que uma recusa não desfaça as outras.
func (b *batch) applyOne(ctx context.Context, idx int, op Op) (Result, error) {
	res := Result{OpID: op.OpID}
	sp, err := b.tx.Begin(ctx)
	if err != nil {
		return res, err
	}
	oc := b.dispatch(ctx, sp, op)
	if oc.err != nil {
		_ = sp.Rollback(ctx)
		return res, oc.err
	}
	if oc.rej == nil && oc.stale == nil && !oc.applied {
		_ = sp.Rollback(ctx)
		return res, errors.New("sync: operação sem desfecho")
	}
	switch {
	case oc.rej != nil:
		_ = sp.Rollback(ctx)
		res.Status, res.Code, res.Details = resultRejected, oc.rej.code, oc.rej.details
	case oc.stale != nil:
		_ = sp.Rollback(ctx)
		res.Status, res.Current = resultStale, oc.stale
	default:
		if err := sp.Commit(ctx); err != nil {
			return res, err
		}
		res.Status = resultApplied
		for _, id := range oc.fx.transfers {
			b.note(fxTransfer, id, idx)
		}
		for _, id := range oc.fx.movements {
			b.note(fxMovement, id, idx)
		}
		for _, id := range oc.fx.investments {
			b.note(fxInvestment, id, idx)
		}
		if oc.fx.deletedAccount != nil {
			b.note(fxAccountDel, *oc.fx.deletedAccount, idx)
		}
		if oc.fx.deletedCategory != nil {
			b.note(fxCategoryDel, *oc.fx.deletedCategory, idx)
		}
	}
	return res, nil
}

// opCtx reúne o que cada aplicador de entidade precisa.
type opCtx struct {
	ctx    context.Context
	q      *store.Queries
	userID uuid.UUID
	op     Op
	eff    time.Time // updated_at efetivo, já limitado por GER-05
	today  time.Time
}

// dispatch decodifica, valida e grava uma operação. Erros do banco viram recusas
// (GER-03, GER-09) quando são de integridade; os demais abortam o lote.
func (b *batch) dispatch(ctx context.Context, sp pgx.Tx, op Op) (oc outcome) {
	o := &opCtx{ctx: ctx, q: store.New(sp), userID: b.userID, op: op, today: b.today,
		eff: effectiveUpdatedAt(op.UpdatedAt, b.now)}
	switch op.Entity {
	case EntityProfile:
		oc = o.profile()
	case EntityAccounts:
		oc = o.account()
	case EntityCategories:
		oc = o.category()
	case EntityTransactions:
		oc = o.transaction()
	case EntityInvestments:
		oc = o.investment()
	case EntityInvestmentMovements:
		oc = o.movement()
	case EntityInvestmentSnapshots:
		oc = o.snapshot()
	}
	return oc
}

// effectiveUpdatedAt aplica GER-05: mais de 5 minutos no futuro vira a hora do servidor.
func effectiveUpdatedAt(t, now time.Time) time.Time {
	t = t.UTC().Truncate(time.Microsecond)
	if t.After(now.Add(futureSlack)) {
		return now.Truncate(time.Microsecond)
	}
	return t
}

func instantNow(t time.Time) string { return t.UTC().Format(instantLayout) }

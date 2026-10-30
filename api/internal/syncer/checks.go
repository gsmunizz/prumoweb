package syncer

import (
	"context"
	"errors"
	"math/big"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

// check roda as regras que envolvem mais de um registro (SYN-05) sobre o estado final do lote:
// TRX-12, INV-13, INV-15, CON-11 e CAT-04. Só olha para o que o lote tocou.
func (b *batch) check(ctx context.Context) ([]violation, error) {
	q := store.New(b.tx)
	var viols []violation
	add := func(r *rejection, ops []int) { viols = append(viols, violation{rejection: *r, ops: ops}) }

	for id, ops := range b.fx[fxTransfer] { // TRX-10 a TRX-12
		r, err := checkTransfer(ctx, q, id)
		if err != nil {
			return nil, err
		}
		if r != nil {
			add(r, ops)
		}
	}
	for id, ops := range b.fx[fxMovement] { // INV-15
		r, err := checkMovementLink(ctx, q, id)
		if err != nil {
			return nil, err
		}
		if r != nil {
			add(r, ops)
		}
	}
	for id, ops := range b.fx[fxInvestment] { // INV-13
		r, err := checkPosition(ctx, q, id)
		if err != nil {
			return nil, err
		}
		if r != nil {
			add(r, ops)
		}
	}
	for id, ops := range b.fx[fxAccountDel] { // CON-11
		inUse, err := accountInUse(ctx, q, id)
		if err != nil {
			return nil, err
		}
		if inUse {
			add(reject("ACCOUNT_IN_USE"), ops)
		}
	}
	for id, ops := range b.fx[fxCategoryDel] { // CAT-04
		n, err := q.CountActiveTransactionsOfCategory(ctx, uuid.NullUUID{UUID: id, Valid: true})
		if err != nil {
			return nil, err
		}
		if n > 0 {
			add(reject("CATEGORY_IN_USE"), ops)
		}
	}
	return viols, nil
}

func activeTransactions(rows []store.Transaction) []store.Transaction {
	var out []store.Transaction
	for _, r := range rows {
		if !r.DeletedAt.Valid {
			out = append(out, r)
		}
	}
	return out
}

// checkTransfer: ou as duas metades estão excluídas, ou há exatamente duas ativas, uma despesa
// e uma receita, com mesmo valor e mesma data em contas diferentes.
func checkTransfer(ctx context.Context, q *store.Queries, id uuid.UUID) (*rejection, error) {
	rows, err := q.ListTransactionsByTransfer(ctx, uuid.NullUUID{UUID: id, Valid: true})
	if err != nil {
		return nil, err
	}
	active := activeTransactions(rows)
	switch {
	case len(active) == 0:
		return nil, nil
	case len(active) != 2:
		return reject("TRANSFER_INCOMPLETE", httpx.FieldError{Field: "transfer_id", Reason: "INVALID_VALUE"}), nil
	}
	x, y := active[0], active[1]
	switch {
	case x.AccountID == y.AccountID:
		return reject("TRANSFER_SAME_ACCOUNT", httpx.FieldError{Field: "account_id", Reason: "INVALID_VALUE"}), nil
	case x.Type == y.Type || x.AmountCents != y.AmountCents || !x.Date.Time.Equal(y.Date.Time):
		return reject("TRANSFER_INVALID", httpx.FieldError{Field: "transfer_id", Reason: "INVALID_VALUE"}), nil
	}
	return nil, nil
}

// checkMovementLink: movimento com conta tem exatamente uma transação interna ativa, do tipo,
// valor, data e conta certos; sem conta ou excluído, não tem nenhuma. Movimentos de ativo
// excluído ficam de fora: a cascata do INV-06 mantém as transações de conta.
func checkMovementLink(ctx context.Context, q *store.Queries, id uuid.UUID) (*rejection, error) {
	m, err := q.GetMovement(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	inv, err := q.GetInvestment(ctx, m.InvestmentID)
	if err != nil {
		return nil, err
	}
	if inv.DeletedAt.Valid {
		return nil, nil
	}
	rows, err := q.ListTransactionsByMovement(ctx, uuid.NullUUID{UUID: id, Valid: true})
	if err != nil {
		return nil, err
	}
	active := activeTransactions(rows)
	bad := reject("VALIDATION_FAILED", httpx.FieldError{Field: "investment_movement_id", Reason: "INVALID_VALUE"})
	if m.DeletedAt.Valid || !m.AccountID.Valid {
		if len(active) > 0 {
			return bad, nil
		}
		return nil, nil
	}
	if len(active) != 1 {
		return bad, nil
	}
	t := active[0]
	want := "expense" // aporte vira despesa interna, resgate vira receita interna (INV-15)
	if m.Type == "resgate" {
		want = "income"
	}
	if t.Type != want || t.AmountCents != m.AmountCents || !t.Date.Time.Equal(m.Date.Time) || t.AccountID != m.AccountID.UUID {
		return bad, nil
	}
	return nil, nil
}

// checkPosition: a quantidade da posição nunca fica negativa em nenhuma data (INV-13).
func checkPosition(ctx context.Context, q *store.Queries, investmentID uuid.UUID) (*rejection, error) {
	inv, err := q.GetInvestment(ctx, investmentID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && inv.DeletedAt.Valid) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rows, err := q.ListActiveMovementsOfInvestment(ctx, investmentID)
	if err != nil {
		return nil, err
	}
	pos := new(big.Rat)
	for _, m := range rows {
		qty, ok := new(big.Rat).SetString(m.Quantity)
		if !ok {
			return nil, errors.New("sync: quantidade inválida no banco")
		}
		if m.Type == "aporte" {
			pos.Add(pos, qty)
		} else {
			pos.Sub(pos, qty)
		}
		if pos.Sign() < 0 {
			return reject("REDEMPTION_EXCEEDS_POSITION", httpx.FieldError{Field: "quantity", Reason: "OUT_OF_RANGE"}), nil
		}
	}
	return nil, nil
}

func accountInUse(ctx context.Context, q *store.Queries, id uuid.UUID) (bool, error) {
	n, err := q.CountActiveTransactionsOfAccount(ctx, id)
	if err != nil || n > 0 {
		return n > 0, err
	}
	nullID := uuid.NullUUID{UUID: id, Valid: true}
	if n, err = q.CountActiveInvestmentsOfAccount(ctx, nullID); err != nil || n > 0 {
		return n > 0, err
	}
	n, err = q.CountActiveMovementsOfAccount(ctx, nullID)
	return n > 0, err
}

package syncer

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/gsmunizz/prumoweb/api/internal/httpx"
	"github.com/gsmunizz/prumoweb/api/internal/store"
)

// SnapshotNamespace é o namespace do UUID v5 dos snapshots (INV-21). O cliente usa o mesmo.
var SnapshotNamespace = uuid.MustParse("7d1c5b2e-4f3a-4a6b-9c8d-0e1f2a3b4c5d")

// SnapshotID calcula o id determinístico de um snapshot: UUID v5 de "<investment_id>:<AAAA-MM-DD>".
func SnapshotID(investmentID uuid.UUID, date string) uuid.UUID {
	return uuid.NewSHA1(SnapshotNamespace, []byte(investmentID.String()+":"+date))
}

func applied(fx effects) outcome         { return outcome{applied: true, fx: fx} }
func rejected(r *rejection) outcome      { return outcome{rej: r} }
func staleWith(current any) outcome      { return outcome{stale: current} }
func (o *opCtx) wins(cur time.Time) bool { return o.eff.After(cur.UTC().Truncate(time.Microsecond)) }

// dbOutcome traduz um erro do banco: violações de integridade viram recusas da operação
// (GER-03, GER-09), as demais abortam o lote.
func dbOutcome(err error) outcome {
	code, constraint := pgCode(err)
	switch {
	case code == "23505" && strings.HasSuffix(constraint, "_pkey"):
		// O id existe, mas é de outro usuário (a RLS esconde a linha): GER-03.
		return rejected(reject("NOT_FOUND"))
	case code == "23503":
		return rejected(reject("REFERENCE_NOT_FOUND"))
	case code == "23505" || code == "23514" || strings.HasPrefix(code, "22"):
		return rejected(reject("VALIDATION_FAILED"))
	}
	return outcome{err: err}
}

func decode(data json.RawMessage, into any) *rejection {
	if err := json.Unmarshal(data, into); err != nil {
		return reject("VALIDATION_FAILED", httpx.FieldError{Field: "data", Reason: "INVALID_FORMAT"})
	}
	return nil
}

func deletedAt(f *fieldCheck, p *time.Time) *time.Time {
	if p == nil {
		return nil
	}
	if p.IsZero() {
		f.add("deleted_at", "INVALID_FORMAT")
		return nil
	}
	t := p.UTC().Truncate(time.Microsecond)
	return &t
}

// --- referências (GER-08, GER-09) ---

// refAccount exige a conta; se estiver excluída, o servidor a restaura (GER-08).
func (o *opCtx) refAccount(field string, id uuid.UUID) (*rejection, error) {
	a, err := o.q.GetAccount(o.ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return reject("REFERENCE_NOT_FOUND", httpx.FieldError{Field: field, Reason: "NOT_FOUND"}), nil
	}
	if err != nil {
		return nil, err
	}
	if a.DeletedAt.Valid {
		return nil, o.q.RestoreAccount(o.ctx, store.RestoreAccountParams{ID: id, At: ts(o.eff)})
	}
	return nil, nil
}

func (o *opCtx) refInvestment(field string, id uuid.UUID) (*rejection, error) {
	i, err := o.q.GetInvestment(o.ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return reject("REFERENCE_NOT_FOUND", httpx.FieldError{Field: field, Reason: "NOT_FOUND"}), nil
	}
	if err != nil {
		return nil, err
	}
	if i.DeletedAt.Valid {
		return nil, o.q.RestoreInvestment(o.ctx, store.RestoreInvestmentParams{ID: id, At: ts(o.eff)})
	}
	return nil, nil
}

// refCategory exige a categoria do mesmo tipo da transação (TRX-04) e a restaura se excluída.
func (o *opCtx) refCategory(field string, id uuid.UUID, txType string) (*rejection, error) {
	c, err := o.q.GetCategory(o.ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return reject("REFERENCE_NOT_FOUND", httpx.FieldError{Field: field, Reason: "NOT_FOUND"}), nil
	}
	if err != nil {
		return nil, err
	}
	if c.Type != txType {
		return reject("CATEGORY_TYPE_MISMATCH", httpx.FieldError{Field: field, Reason: "INVALID_VALUE"}), nil
	}
	if c.DeletedAt.Valid {
		return nil, o.q.RestoreCategory(o.ctx, store.RestoreCategoryParams{ID: id, At: ts(o.eff)})
	}
	return nil, nil
}

// --- perfil ---

type profileIn struct {
	Name      *string    `json:"name"`
	Currency  *string    `json:"currency"`
	Timezone  *string    `json:"timezone"`
	Theme     *string    `json:"theme"`
	DeletedAt *time.Time `json:"deleted_at"`
}

func (o *opCtx) profile() outcome {
	var in profileIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	name := f.required("name", in.Name, 1, 80, false)
	if in.Currency == nil || *in.Currency != "BRL" { // AUT-08
		f.add("currency", "INVALID_VALUE")
	}
	tz := ""
	if in.Timezone == nil {
		f.add("timezone", "REQUIRED")
	} else if tz = *in.Timezone; tz == "" || tz == "Local" {
		f.add("timezone", "INVALID_VALUE")
	} else if _, err := time.LoadLocation(tz); err != nil {
		f.add("timezone", "INVALID_VALUE")
	}
	theme := f.oneOf("theme", in.Theme, themes)
	if in.DeletedAt != nil {
		f.add("deleted_at", "INVALID_VALUE") // o perfil não se exclui
	}
	if o.op.ID != o.userID { // SYN-01: o perfil usa o id do usuário
		f.add("id", "INVALID_VALUE")
	}
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}

	cur, err := o.q.GetProfile(o.ctx, o.userID)
	if errors.Is(err, pgx.ErrNoRows) {
		return rejected(reject("NOT_FOUND"))
	}
	if err != nil {
		return outcome{err: err}
	}
	if !o.wins(cur.UpdatedAt.Time) {
		return staleWith(profileRecord(cur))
	}
	if err := o.q.UpdateProfile(o.ctx, store.UpdateProfileParams{
		ID: o.userID, Name: name, Currency: "BRL", Timezone: tz, Theme: theme, UpdatedAt: ts(o.eff),
	}); err != nil {
		return dbOutcome(err)
	}
	return applied(effects{})
}

// --- contas ---

type accountIn struct {
	Name                *string    `json:"name"`
	Type                *string    `json:"type"`
	InitialBalanceCents *int64     `json:"initial_balance_cents"`
	Color               *string    `json:"color"`
	Icon                *string    `json:"icon"`
	Archived            *bool      `json:"archived"`
	SortOrder           *int64     `json:"sort_order"`
	CreatedAt           *time.Time `json:"created_at"`
	DeletedAt           *time.Time `json:"deleted_at"`
}

func (o *opCtx) account() outcome {
	var in accountIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	name := f.required("name", in.Name, 1, 40, false)
	typ := f.oneOf("type", in.Type, accountTypes)
	balance := f.money("initial_balance_cents", in.InitialBalanceCents, -maxMoneyCents, maxMoneyCents)
	color := f.color("color", in.Color)
	icon := f.icon("icon", in.Icon, false)
	archived := f.boolean("archived", in.Archived)
	order := f.sortOrder("sort_order", in.SortOrder)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}

	var fx effects
	if del != nil {
		fx.deletedAccount = &o.op.ID // CON-11, conferida ao fim do lote
	}
	cur, err := o.q.GetAccount(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(accountRecord(cur))
		}
		err = o.q.UpdateAccount(o.ctx, store.UpdateAccountParams{
			ID: o.op.ID, Name: name, Type: typ, InitialBalanceCents: balance, Color: color, Icon: pgText(icon),
			Archived: archived, SortOrder: order, UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertAccount(o.ctx, store.InsertAccountParams{
			ID: o.op.ID, UserID: o.userID, Name: name, Type: typ, InitialBalanceCents: balance, Color: color, Icon: pgText(icon),
			Archived: archived, SortOrder: order, CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	return applied(fx)
}

// --- categorias ---

type categoryIn struct {
	Name      *string    `json:"name"`
	Type      *string    `json:"type"`
	Icon      *string    `json:"icon"`
	Color     *string    `json:"color"`
	SortOrder *int64     `json:"sort_order"`
	CreatedAt *time.Time `json:"created_at"`
	DeletedAt *time.Time `json:"deleted_at"`
}

func (o *opCtx) category() outcome {
	var in categoryIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	name := f.required("name", in.Name, 1, 30, false)
	typ := f.oneOf("type", in.Type, set("income", "expense"))
	icon := f.icon("icon", in.Icon, true)
	color := f.color("color", in.Color)
	order := f.sortOrder("sort_order", in.SortOrder)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}

	var fx effects
	if del != nil {
		fx.deletedCategory = &o.op.ID // CAT-04, conferida ao fim do lote
	}
	cur, err := o.q.GetCategory(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(categoryRecord(cur))
		}
		if cur.Type != typ { // CAT-02
			return rejected(reject("CATEGORY_TYPE_IMMUTABLE", httpx.FieldError{Field: "type", Reason: "IMMUTABLE"}))
		}
		err = o.q.UpdateCategory(o.ctx, store.UpdateCategoryParams{
			ID: o.op.ID, Name: name, Icon: *icon, Color: color, SortOrder: order, UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertCategory(o.ctx, store.InsertCategoryParams{
			ID: o.op.ID, UserID: o.userID, Name: name, Type: typ, Icon: *icon, Color: color, SortOrder: order,
			CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	return applied(fx)
}

// --- transações ---

type transactionIn struct {
	Type                 *string    `json:"type"`
	AmountCents          *int64     `json:"amount_cents"`
	Description          *string    `json:"description"`
	Date                 *string    `json:"date"`
	AccountID            *uuid.UUID `json:"account_id"`
	CategoryID           *uuid.UUID `json:"category_id"`
	Notes                *string    `json:"notes"`
	TransferID           *uuid.UUID `json:"transfer_id"`
	InvestmentMovementID *uuid.UUID `json:"investment_movement_id"`
	CreatedAt            *time.Time `json:"created_at"`
	DeletedAt            *time.Time `json:"deleted_at"`
}

func (o *opCtx) transaction() outcome {
	var in transactionIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	typ := f.oneOf("type", in.Type, set("income", "expense"))
	amount := f.money("amount_cents", in.AmountCents, 1, maxMoneyCents) // TRX-03
	desc := f.optional("description", in.Description, 140, false)       // TRX-05
	notes := f.optional("notes", in.Notes, 1000, true)
	date := f.date("date", in.Date, o.today)
	account := f.id("account_id", in.AccountID)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}

	// Movimentação interna (transferência ou aporte ligado a conta) não tem categoria; as demais têm (TRX-04, TRX-11).
	internal := in.TransferID != nil || in.InvestmentMovementID != nil
	switch {
	case in.TransferID != nil && in.InvestmentMovementID != nil:
		return rejected(reject("VALIDATION_FAILED", httpx.FieldError{Field: "transfer_id", Reason: "INVALID_VALUE"}))
	case in.TransferID != nil && in.CategoryID != nil:
		return rejected(reject("TRANSFER_INVALID", httpx.FieldError{Field: "category_id", Reason: "INVALID_VALUE"}))
	case internal && in.CategoryID != nil:
		return rejected(reject("VALIDATION_FAILED", httpx.FieldError{Field: "category_id", Reason: "INVALID_VALUE"}))
	case !internal && in.CategoryID == nil:
		return rejected(reject("VALIDATION_FAILED", httpx.FieldError{Field: "category_id", Reason: "REQUIRED"}))
	}

	if cur, err := o.q.GetTransaction(o.ctx, o.op.ID); err == nil && !o.wins(cur.UpdatedAt.Time) {
		return staleWith(transactionRecord(cur)) // antes de restaurar qualquer pai (GER-08)
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return outcome{err: err}
	}
	if r, err := o.refAccount("account_id", account); r != nil || err != nil {
		return refOutcome(r, err)
	}
	if in.CategoryID != nil {
		if r, err := o.refCategory("category_id", *in.CategoryID, typ); r != nil || err != nil {
			return refOutcome(r, err)
		}
	}
	if in.InvestmentMovementID != nil {
		if _, err := o.q.GetMovement(o.ctx, *in.InvestmentMovementID); errors.Is(err, pgx.ErrNoRows) {
			return rejected(reject("REFERENCE_NOT_FOUND", httpx.FieldError{Field: "investment_movement_id", Reason: "NOT_FOUND"}))
		} else if err != nil {
			return outcome{err: err}
		}
	}

	var fx effects
	addGroup := func(transfer, movement *uuid.UUID) {
		if transfer != nil {
			fx.transfers = append(fx.transfers, *transfer)
		}
		if movement != nil {
			fx.movements = append(fx.movements, *movement)
		}
	}
	addGroup(in.TransferID, in.InvestmentMovementID)

	cur, err := o.q.GetTransaction(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(transactionRecord(cur))
		}
		// O vínculo antigo também precisa continuar consistente depois da edição.
		addGroup(uuidPtr(cur.TransferID), uuidPtr(cur.InvestmentMovementID))
		err = o.q.UpdateTransaction(o.ctx, store.UpdateTransactionParams{
			ID: o.op.ID, Type: typ, AmountCents: amount, Description: pgText(desc), Date: pgDate(date), AccountID: account,
			CategoryID: nullUUID(in.CategoryID), Notes: pgText(notes), TransferID: nullUUID(in.TransferID),
			InvestmentMovementID: nullUUID(in.InvestmentMovementID), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertTransaction(o.ctx, store.InsertTransactionParams{
			ID: o.op.ID, UserID: o.userID, Type: typ, AmountCents: amount, Description: pgText(desc), Date: pgDate(date), AccountID: account,
			CategoryID: nullUUID(in.CategoryID), Notes: pgText(notes), TransferID: nullUUID(in.TransferID),
			InvestmentMovementID: nullUUID(in.InvestmentMovementID), CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	return applied(fx)
}

func refOutcome(r *rejection, err error) outcome {
	if err != nil {
		return dbOutcome(err)
	}
	return rejected(r)
}

// --- investimentos ---

type investmentIn struct {
	Name       *string    `json:"name"`
	AssetClass *string    `json:"asset_class"`
	Ticker     *string    `json:"ticker"`
	AccountID  *uuid.UUID `json:"account_id"`
	Notes      *string    `json:"notes"`
	CreatedAt  *time.Time `json:"created_at"`
	DeletedAt  *time.Time `json:"deleted_at"`
}

func (o *opCtx) investment() outcome {
	var in investmentIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	name := f.required("name", in.Name, 1, 60, false)
	class := f.oneOf("asset_class", in.AssetClass, assetClasses)
	var ticker *string
	if in.Ticker != nil && cleanText(*in.Ticker, false) != "" {
		t := strings.ToUpper(cleanText(*in.Ticker, false)) // INV-03
		if !tickerRe.MatchString(t) {
			f.add("ticker", "INVALID_FORMAT")
		}
		ticker = &t
	}
	notes := f.optional("notes", in.Notes, 1000, true)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}
	if cur, err := o.q.GetInvestment(o.ctx, o.op.ID); err == nil && !o.wins(cur.UpdatedAt.Time) {
		return staleWith(investmentRecord(cur))
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return outcome{err: err}
	}
	if in.AccountID != nil {
		if r, err := o.refAccount("account_id", *in.AccountID); r != nil || err != nil {
			return refOutcome(r, err)
		}
	}

	cur, err := o.q.GetInvestment(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(investmentRecord(cur))
		}
		err = o.q.UpdateInvestment(o.ctx, store.UpdateInvestmentParams{
			ID: o.op.ID, Name: name, AssetClass: class, Ticker: pgText(ticker), AccountID: nullUUID(in.AccountID),
			Notes: pgText(notes), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertInvestment(o.ctx, store.InsertInvestmentParams{
			ID: o.op.ID, UserID: o.userID, Name: name, AssetClass: class, Ticker: pgText(ticker), AccountID: nullUUID(in.AccountID),
			Notes: pgText(notes), CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	if del != nil { // INV-06: movimentos e snapshots saem junto, na mesma transação do banco
		at := pgtype.Timestamptz{Time: *del, Valid: true}
		if err := o.q.CascadeDeleteMovements(o.ctx, store.CascadeDeleteMovementsParams{InvestmentID: o.op.ID, DeletedAt: at, At: ts(o.eff)}); err != nil {
			return dbOutcome(err)
		}
		if err := o.q.CascadeDeleteSnapshots(o.ctx, store.CascadeDeleteSnapshotsParams{InvestmentID: o.op.ID, DeletedAt: at, At: ts(o.eff)}); err != nil {
			return dbOutcome(err)
		}
	}
	return applied(effects{})
}

// --- movimentos ---

type movementIn struct {
	InvestmentID *uuid.UUID      `json:"investment_id"`
	Type         *string         `json:"type"`
	Date         *string         `json:"date"`
	Quantity     json.RawMessage `json:"quantity"`
	AmountCents  *int64          `json:"amount_cents"`
	AccountID    *uuid.UUID      `json:"account_id"`
	CreatedAt    *time.Time      `json:"created_at"`
	DeletedAt    *time.Time      `json:"deleted_at"`
}

func (o *opCtx) movement() outcome {
	var in movementIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	investment := f.id("investment_id", in.InvestmentID)
	typ := f.oneOf("type", in.Type, set("aporte", "resgate"))
	date := f.date("date", in.Date, o.today)
	qty := f.quantity("quantity", in.Quantity)
	amount := f.money("amount_cents", in.AmountCents, 1, maxMoneyCents)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}
	if cur, err := o.q.GetMovement(o.ctx, o.op.ID); err == nil && !o.wins(cur.UpdatedAt.Time) {
		return staleWith(movementRecord(cur))
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return outcome{err: err}
	}
	if r, err := o.refInvestment("investment_id", investment); r != nil || err != nil {
		return refOutcome(r, err)
	}
	if in.AccountID != nil {
		if r, err := o.refAccount("account_id", *in.AccountID); r != nil || err != nil {
			return refOutcome(r, err)
		}
	}

	fx := effects{movements: []uuid.UUID{o.op.ID}, investments: []uuid.UUID{investment}}
	cur, err := o.q.GetMovement(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(movementRecord(cur))
		}
		if cur.InvestmentID != investment { // a posição do ativo antigo também muda
			fx.investments = append(fx.investments, cur.InvestmentID)
		}
		err = o.q.UpdateMovement(o.ctx, store.UpdateMovementParams{
			ID: o.op.ID, InvestmentID: investment, Type: typ, Date: pgDate(date), Quantity: qty, AmountCents: amount,
			AccountID: nullUUID(in.AccountID), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertMovement(o.ctx, store.InsertMovementParams{
			ID: o.op.ID, UserID: o.userID, InvestmentID: investment, Type: typ, Date: pgDate(date), Quantity: qty, AmountCents: amount,
			AccountID: nullUUID(in.AccountID), CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	return applied(fx)
}

// --- snapshots ---

type snapshotIn struct {
	InvestmentID *uuid.UUID `json:"investment_id"`
	Date         *string    `json:"date"`
	ValueCents   *int64     `json:"value_cents"`
	CreatedAt    *time.Time `json:"created_at"`
	DeletedAt    *time.Time `json:"deleted_at"`
}

func (o *opCtx) snapshot() outcome {
	var in snapshotIn
	if r := decode(o.op.Data, &in); r != nil {
		return rejected(r)
	}
	var f fieldCheck
	investment := f.id("investment_id", in.InvestmentID)
	date := f.date("date", in.Date, o.today)
	value := f.money("value_cents", in.ValueCents, 0, maxMoneyCents)
	created := f.instantRequired("created_at", in.CreatedAt)
	del := deletedAt(&f, in.DeletedAt)
	if f.ok() && o.op.ID != SnapshotID(investment, *in.Date) { // INV-21
		f.add("id", "INVALID_VALUE")
	}
	if !f.ok() {
		return rejected(validationFailed(f.errs))
	}
	if cur, err := o.q.GetSnapshot(o.ctx, o.op.ID); err == nil && !o.wins(cur.UpdatedAt.Time) {
		return staleWith(snapshotRecord(cur))
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return outcome{err: err}
	}
	if r, err := o.refInvestment("investment_id", investment); r != nil || err != nil {
		return refOutcome(r, err)
	}

	cur, err := o.q.GetSnapshot(o.ctx, o.op.ID)
	switch {
	case err == nil:
		if !o.wins(cur.UpdatedAt.Time) {
			return staleWith(snapshotRecord(cur))
		}
		err = o.q.UpdateSnapshot(o.ctx, store.UpdateSnapshotParams{
			ID: o.op.ID, InvestmentID: investment, Date: pgDate(date), ValueCents: value, UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	case errors.Is(err, pgx.ErrNoRows):
		err = o.q.InsertSnapshot(o.ctx, store.InsertSnapshotParams{
			ID: o.op.ID, UserID: o.userID, InvestmentID: investment, Date: pgDate(date), ValueCents: value,
			CreatedAt: ts(created), UpdatedAt: ts(o.eff), DeletedAt: tsPtr(del),
		})
	}
	if err != nil {
		return dbOutcome(err)
	}
	return applied(effects{})
}

// Package syncer implementa o push e o pull do sync (SYN-*): aplica as operações do aparelho
// com last-write-wins (GER-04) e devolve as mudanças do servidor a partir de um cursor.
package syncer

import (
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"

	"github.com/gsmunizz/prumoweb/api/internal/store"
)

// Entidades sincronizadas (SYN-01), na ordem em que o pull as lista.
const (
	EntityProfile             = "profile"
	EntityAccounts            = "accounts"
	EntityCategories          = "categories"
	EntityTransactions        = "transactions"
	EntityInvestments         = "investments"
	EntityInvestmentMovements = "investment_movements"
	EntityInvestmentSnapshots = "investment_snapshots"
)

var entities = []string{
	EntityProfile, EntityAccounts, EntityCategories, EntityTransactions,
	EntityInvestments, EntityInvestmentMovements, EntityInvestmentSnapshots,
}

func knownEntity(name string) bool {
	for _, e := range entities {
		if e == name {
			return true
		}
	}
	return false
}

// Os registros abaixo são o formato de resposta do sync: o mesmo no pull e em "current".
// Instantes em RFC 3339 UTC com milissegundos; datas de calendário como AAAA-MM-DD.

type ProfileRecord struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Currency      string    `json:"currency"`
	Timezone      string    `json:"timezone"`
	Theme         string    `json:"theme"`
	CreatedAt     string    `json:"created_at"`
	UpdatedAt     string    `json:"updated_at"`
	DeletedAt     *string   `json:"deleted_at"`
	ServerVersion int64     `json:"server_version"`
}

type AccountRecord struct {
	ID                  uuid.UUID `json:"id"`
	Name                string    `json:"name"`
	Type                string    `json:"type"`
	InitialBalanceCents int64     `json:"initial_balance_cents"`
	Color               string    `json:"color"`
	Icon                *string   `json:"icon"`
	Archived            bool      `json:"archived"`
	SortOrder           int32     `json:"sort_order"`
	CreatedAt           string    `json:"created_at"`
	UpdatedAt           string    `json:"updated_at"`
	DeletedAt           *string   `json:"deleted_at"`
	ServerVersion       int64     `json:"server_version"`
}

type CategoryRecord struct {
	ID            uuid.UUID `json:"id"`
	Name          string    `json:"name"`
	Type          string    `json:"type"`
	Icon          string    `json:"icon"`
	Color         string    `json:"color"`
	SortOrder     int32     `json:"sort_order"`
	CreatedAt     string    `json:"created_at"`
	UpdatedAt     string    `json:"updated_at"`
	DeletedAt     *string   `json:"deleted_at"`
	ServerVersion int64     `json:"server_version"`
}

type TransactionRecord struct {
	ID                   uuid.UUID  `json:"id"`
	Type                 string     `json:"type"`
	AmountCents          int64      `json:"amount_cents"`
	Description          *string    `json:"description"`
	Date                 string     `json:"date"`
	AccountID            uuid.UUID  `json:"account_id"`
	CategoryID           *uuid.UUID `json:"category_id"`
	Notes                *string    `json:"notes"`
	TransferID           *uuid.UUID `json:"transfer_id"`
	InvestmentMovementID *uuid.UUID `json:"investment_movement_id"`
	CreatedAt            string     `json:"created_at"`
	UpdatedAt            string     `json:"updated_at"`
	DeletedAt            *string    `json:"deleted_at"`
	ServerVersion        int64      `json:"server_version"`
}

type InvestmentRecord struct {
	ID            uuid.UUID  `json:"id"`
	Name          string     `json:"name"`
	AssetClass    string     `json:"asset_class"`
	Ticker        *string    `json:"ticker"`
	AccountID     *uuid.UUID `json:"account_id"`
	Notes         *string    `json:"notes"`
	CreatedAt     string     `json:"created_at"`
	UpdatedAt     string     `json:"updated_at"`
	DeletedAt     *string    `json:"deleted_at"`
	ServerVersion int64      `json:"server_version"`
}

type MovementRecord struct {
	ID            uuid.UUID  `json:"id"`
	InvestmentID  uuid.UUID  `json:"investment_id"`
	Type          string     `json:"type"`
	Date          string     `json:"date"`
	Quantity      string     `json:"quantity"` // decimal em texto, sem perder casas
	AmountCents   int64      `json:"amount_cents"`
	AccountID     *uuid.UUID `json:"account_id"`
	CreatedAt     string     `json:"created_at"`
	UpdatedAt     string     `json:"updated_at"`
	DeletedAt     *string    `json:"deleted_at"`
	ServerVersion int64      `json:"server_version"`
}

type SnapshotRecord struct {
	ID            uuid.UUID `json:"id"`
	InvestmentID  uuid.UUID `json:"investment_id"`
	Date          string    `json:"date"`
	ValueCents    int64     `json:"value_cents"`
	CreatedAt     string    `json:"created_at"`
	UpdatedAt     string    `json:"updated_at"`
	DeletedAt     *string   `json:"deleted_at"`
	ServerVersion int64     `json:"server_version"`
}

const instantLayout = "2006-01-02T15:04:05.000Z"
const dateLayout = "2006-01-02"

func instant(t pgtype.Timestamptz) string { return t.Time.UTC().Format(instantLayout) }

func instantPtr(t pgtype.Timestamptz) *string {
	if !t.Valid {
		return nil
	}
	s := instant(t)
	return &s
}

func dateStr(d pgtype.Date) string { return d.Time.Format(dateLayout) }

func textPtr(t pgtype.Text) *string {
	if !t.Valid {
		return nil
	}
	s := t.String
	return &s
}

func uuidPtr(u uuid.NullUUID) *uuid.UUID {
	if !u.Valid {
		return nil
	}
	id := u.UUID
	return &id
}

// quantityText tira os zeros à direita de um numeric(28,8): "1.50000000" vira "1.5".
func quantityText(q string) string {
	if strings.Contains(q, ".") {
		q = strings.TrimRight(q, "0")
		q = strings.TrimSuffix(q, ".")
	}
	return q
}

func profileRecord(r store.Profile) ProfileRecord {
	return ProfileRecord{ID: r.ID, Name: r.Name, Currency: r.Currency, Timezone: r.Timezone, Theme: r.Theme,
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func accountRecord(r store.Account) AccountRecord {
	return AccountRecord{ID: r.ID, Name: r.Name, Type: r.Type, InitialBalanceCents: r.InitialBalanceCents, Color: r.Color,
		Icon: textPtr(r.Icon), Archived: r.Archived, SortOrder: r.SortOrder,
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func categoryRecord(r store.Category) CategoryRecord {
	return CategoryRecord{ID: r.ID, Name: r.Name, Type: r.Type, Icon: r.Icon, Color: r.Color, SortOrder: r.SortOrder,
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func transactionRecord(r store.Transaction) TransactionRecord {
	return TransactionRecord{ID: r.ID, Type: r.Type, AmountCents: r.AmountCents, Description: textPtr(r.Description),
		Date: dateStr(r.Date), AccountID: r.AccountID, CategoryID: uuidPtr(r.CategoryID), Notes: textPtr(r.Notes),
		TransferID: uuidPtr(r.TransferID), InvestmentMovementID: uuidPtr(r.InvestmentMovementID),
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func investmentRecord(r store.Investment) InvestmentRecord {
	return InvestmentRecord{ID: r.ID, Name: r.Name, AssetClass: r.AssetClass, Ticker: textPtr(r.Ticker), AccountID: uuidPtr(r.AccountID),
		Notes: textPtr(r.Notes), CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt),
		DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func movementRecord(r store.GetMovementRow) MovementRecord {
	return MovementRecord{ID: r.ID, InvestmentID: r.InvestmentID, Type: r.Type, Date: dateStr(r.Date), Quantity: quantityText(r.Quantity),
		AmountCents: r.AmountCents, AccountID: uuidPtr(r.AccountID),
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func snapshotRecord(r store.InvestmentSnapshot) SnapshotRecord {
	return SnapshotRecord{ID: r.ID, InvestmentID: r.InvestmentID, Date: dateStr(r.Date), ValueCents: r.ValueCents,
		CreatedAt: instant(r.CreatedAt), UpdatedAt: instant(r.UpdatedAt), DeletedAt: instantPtr(r.DeletedAt), ServerVersion: r.ServerVersion}
}

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

func tsPtr(t *time.Time) pgtype.Timestamptz {
	if t == nil {
		return pgtype.Timestamptz{}
	}
	return ts(*t)
}

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func pgText(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

func nullUUID(u *uuid.UUID) uuid.NullUUID {
	if u == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *u, Valid: true}
}

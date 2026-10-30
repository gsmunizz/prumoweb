package syncer

import (
	"context"
	"sort"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/gsmunizz/prumoweb/api/internal/store"
)

// PullResponse é o corpo do GET /sync/pull (SYN-08). changes tem sempre as sete chaves.
type PullResponse struct {
	Changes    map[string][]any `json:"changes"`
	NextSince  int64            `json:"next_since"`
	HasMore    bool             `json:"has_more"`
	ServerTime string           `json:"server_time"`
}

type pulled struct {
	version int64
	entity  string
	record  any
}

// Pull devolve os registros com server_version maior que since, de todas as entidades,
// numa página de até limit registros ordenada por server_version (SYN-08).
func (s *Service) Pull(ctx context.Context, userID uuid.UUID, since int64, limit int) (PullResponse, error) {
	if limit <= 0 || limit > MaxPullLimit {
		limit = MaxPullLimit
	}
	if since < 0 {
		since = 0
	}
	tx, err := s.app.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return PullResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
		return PullResponse{}, err
	}

	q := store.New(tx)
	purged, err := q.GetPurgedThrough(ctx)
	if err != nil {
		return PullResponse{}, err
	}
	if since > 0 && since < purged {
		return PullResponse{}, ErrSyncResetRequired
	}

	// Cada entidade traz até limit+1 linhas: a página final tem no máximo limit, e uma a mais
	// em qualquer lista (ou na soma) diz que há mais.
	lim := int32(limit + 1) //nolint:gosec // limit ≤ 1000
	var all []pulled
	add := func(entity string, version int64, rec any) { all = append(all, pulled{version, entity, rec}) }

	if rows, err := q.ListProfilesSince(ctx, store.ListProfilesSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityProfile, r.ServerVersion, profileRecord(r))
		}
	}
	if rows, err := q.ListAccountsSince(ctx, store.ListAccountsSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityAccounts, r.ServerVersion, accountRecord(r))
		}
	}
	if rows, err := q.ListCategoriesSince(ctx, store.ListCategoriesSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityCategories, r.ServerVersion, categoryRecord(r))
		}
	}
	if rows, err := q.ListTransactionsSince(ctx, store.ListTransactionsSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityTransactions, r.ServerVersion, transactionRecord(r))
		}
	}
	if rows, err := q.ListInvestmentsSince(ctx, store.ListInvestmentsSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityInvestments, r.ServerVersion, investmentRecord(r))
		}
	}
	if rows, err := q.ListMovementsSince(ctx, store.ListMovementsSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityInvestmentMovements, r.ServerVersion, movementRecord(store.GetMovementRow(r)))
		}
	}
	if rows, err := q.ListSnapshotsSince(ctx, store.ListSnapshotsSinceParams{Since: since, Lim: lim}); err != nil {
		return PullResponse{}, err
	} else {
		for _, r := range rows {
			add(EntityInvestmentSnapshots, r.ServerVersion, snapshotRecord(r))
		}
	}

	sort.Slice(all, func(i, j int) bool { return all[i].version < all[j].version })
	resp := PullResponse{Changes: map[string][]any{}, NextSince: since, ServerTime: instantNow(s.now())}
	for _, e := range entities {
		resp.Changes[e] = []any{}
	}
	if len(all) > limit {
		resp.HasMore = true
		all = all[:limit]
	}
	for _, p := range all {
		resp.Changes[p.entity] = append(resp.Changes[p.entity], p.record)
		resp.NextSince = p.version
	}
	return resp, nil
}

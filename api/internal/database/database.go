// Package database abre os pools do Postgres e aplica o isolamento por usuário.
package database

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("DATABASE_URL inválida: %w", err)
	}
	cfg.ConnConfig.RuntimeParams["application_name"] = "prumo-api"
	cfg.ConnConfig.RuntimeParams["timezone"] = "UTC"
	return pgxpool.NewWithConfig(ctx, cfg)
}

// WithUser roda fn numa transação com app.user_id definido (PER-05), para que as
// políticas de RLS (PER-06) liberem só as linhas desse usuário. É a única forma
// de a API tocar nas tabelas financeiras.
func WithUser(ctx context.Context, pool *pgxpool.Pool, userID uuid.UUID, fn func(pgx.Tx) error) error {
	if userID == uuid.Nil {
		return fmt.Errorf("WithUser: user_id vazio")
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		// set_config com is_local = true equivale a SET LOCAL e aceita parâmetro.
		if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
			return err
		}
		return fn(tx)
	})
}

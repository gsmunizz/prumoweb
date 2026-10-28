package database

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Testes de integração do isolamento por usuário (PER-04 a PER-07).
// Precisam de um banco com db/bootstrap.sql e as migrações aplicados:
//   TEST_DATABASE_URL       conecta como prumo_app
//   TEST_AUTH_DATABASE_URL  conecta como prumo_auth
// Sem elas, os testes são pulados.

func pools(t *testing.T) (app, auth *pgxpool.Pool) {
	t.Helper()
	appURL, authURL := os.Getenv("TEST_DATABASE_URL"), os.Getenv("TEST_AUTH_DATABASE_URL")
	if appURL == "" || authURL == "" {
		t.Skip("TEST_DATABASE_URL e TEST_AUTH_DATABASE_URL não definidas")
	}
	ctx := context.Background()
	var err error
	if app, err = Connect(ctx, appURL); err != nil {
		t.Fatal(err)
	}
	if auth, err = Connect(ctx, authURL); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { app.Close(); auth.Close() })
	return app, auth
}

// newUser cria um usuário com perfil e uma conta, como o cadastro fará (AUT-06),
// usando o papel prumo_auth. Devolve o id do usuário e o da conta.
func newUser(t *testing.T, auth *pgxpool.Pool) (userID, accountID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	userID, accountID = uuid.New(), uuid.New()
	now := time.Now().UTC()

	err := pgx.BeginFunc(ctx, auth, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `INSERT INTO users (id, email) VALUES ($1, $2)`, userID, userID.String()+"@teste.prumo"); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String()); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES ($1, $1, 'Teste', $2, $2)`, userID, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO accounts (id, user_id, name, type, color, created_at, updated_at)
			VALUES ($1, $2, 'Carteira', 'carteira', '#2446D8', $3, $3)`, accountID, userID, now)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = auth.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID) })
	return userID, accountID
}

func pgCode(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code
	}
	return ""
}

func TestRLSIsolatesUsers(t *testing.T) {
	app, auth := pools(t)
	ctx := context.Background()
	userA, accountA := newUser(t, auth)
	userB, accountB := newUser(t, auth)

	err := WithUser(ctx, app, userA, func(tx pgx.Tx) error {
		rows, _ := tx.Query(ctx, `SELECT id FROM accounts`)
		ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		if len(ids) != 1 || ids[0] != accountA {
			t.Errorf("A vê as contas %v, quer só %v", ids, accountA)
		}

		// Mesmo sem filtro da aplicação, a conta de B não aparece nem muda.
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM accounts WHERE id = $1`, accountB).Scan(&n); err != nil {
			return err
		}
		if n != 0 {
			t.Error("A enxerga a conta de B")
		}
		tag, err := tx.Exec(ctx, `UPDATE accounts SET name = 'invadida' WHERE id = $1`, accountB)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 0 {
			t.Error("A alterou a conta de B")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}

	// Gravar um registro em nome de B, estando como A, é recusado pelo WITH CHECK.
	err = WithUser(ctx, app, userA, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		_, err := tx.Exec(ctx, `INSERT INTO accounts (id, user_id, name, type, color, created_at, updated_at)
			VALUES ($1, $2, 'x', 'carteira', '#2446D8', $3, $3)`, uuid.New(), userB, now)
		return err
	})
	if code := pgCode(err); code != "42501" {
		t.Errorf("inserir em nome de outro usuário: erro %v (código %q), quer 42501", err, code)
	}
}

func TestRLSWithoutUserReturnsNothing(t *testing.T) {
	app, auth := pools(t)
	ctx := context.Background()
	newUser(t, auth)

	// Esquecer o WithUser vira lista vazia, não vazamento.
	var n int
	if err := app.QueryRow(ctx, `SELECT count(*) FROM accounts`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("sem app.user_id o prumo_app viu %d contas", n)
	}

	// Depois de um SET LOCAL, a sessão fica com app.user_id = '' e continua sem ver nada.
	userID, _ := newUser(t, auth)
	conn, err := app.Acquire(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Release()
	if err := pgx.BeginFunc(ctx, conn, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, "SELECT set_config('app.user_id', $1, true)", userID.String())
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if err := conn.QueryRow(ctx, `SELECT count(*) FROM accounts`).Scan(&n); err != nil {
		t.Fatalf("consulta depois do SET LOCAL falhou: %v", err)
	}
	if n != 0 {
		t.Errorf("depois do SET LOCAL a conexão ainda viu %d contas", n)
	}
}

func TestCrossUserReferenceRejected(t *testing.T) {
	app, auth := pools(t)
	ctx := context.Background()
	userA, _ := newUser(t, auth)
	_, accountB := newUser(t, auth)

	err := WithUser(ctx, app, userA, func(tx pgx.Tx) error {
		now := time.Now().UTC()
		catID := uuid.New()
		if _, err := tx.Exec(ctx, `INSERT INTO categories (id, user_id, name, type, icon, color, created_at, updated_at)
			VALUES ($1, $2, 'Mercado', 'expense', 'shopping-cart', '#0E8577', $3, $3)`, catID, userA, now); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO transactions (id, user_id, type, amount_cents, date, account_id, category_id, created_at, updated_at)
			VALUES ($1, $2, 'expense', 1990, '2026-10-28', $3, $4, $5, $5)`, uuid.New(), userA, accountB, catID, now)
		return err
	})
	if code := pgCode(err); code != "23503" {
		t.Errorf("transação de A na conta de B: erro %v (código %q), quer 23503", err, code)
	}
}

func TestServerVersionAdvances(t *testing.T) {
	app, auth := pools(t)
	ctx := context.Background()
	userA, accountA := newUser(t, auth)

	err := WithUser(ctx, app, userA, func(tx pgx.Tx) error {
		var before, after int64
		if err := tx.QueryRow(ctx, `SELECT server_version FROM accounts WHERE id = $1`, accountA).Scan(&before); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `UPDATE accounts SET archived = true WHERE id = $1 RETURNING server_version`, accountA).Scan(&after); err != nil {
			return err
		}
		if after <= before {
			t.Errorf("server_version não avançou: %d → %d", before, after)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestRolesAreSeparated(t *testing.T) {
	app, auth := pools(t)
	ctx := context.Background()

	if _, err := app.Exec(ctx, `SELECT 1 FROM users LIMIT 1`); pgCode(err) != "42501" {
		t.Errorf("prumo_app leu users: %v", err)
	}
	if _, err := auth.Exec(ctx, `SELECT 1 FROM transactions LIMIT 1`); pgCode(err) != "42501" {
		t.Errorf("prumo_auth leu transactions: %v", err)
	}
}

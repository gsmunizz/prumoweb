-- Consultas do sync. Rodam com o papel prumo_app, dentro de database.WithUser (RLS).

-- name: GetPurgedThrough :one
SELECT purged_through FROM sync_state;

-- Perfil (SYN-01: o id é o do usuário). Só atualiza; o cadastro já criou a linha.
-- name: ListProfilesSince :many
SELECT * FROM profiles WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- name: UpdateProfile :exec
UPDATE profiles
SET name = sqlc.arg(name), currency = sqlc.arg(currency), timezone = sqlc.arg(timezone), theme = sqlc.arg(theme),
    updated_at = sqlc.arg(updated_at), server_version = 0
WHERE id = sqlc.arg(id);

-- Contas
-- name: GetAccount :one
SELECT * FROM accounts WHERE id = sqlc.arg(id);

-- name: InsertAccount :exec
INSERT INTO accounts (id, user_id, name, type, initial_balance_cents, color, icon, archived, sort_order, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(type), sqlc.arg(initial_balance_cents), sqlc.arg(color),
        sqlc.narg(icon), sqlc.arg(archived), sqlc.arg(sort_order), sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateAccount :exec
UPDATE accounts
SET name = sqlc.arg(name), type = sqlc.arg(type), initial_balance_cents = sqlc.arg(initial_balance_cents), color = sqlc.arg(color),
    icon = sqlc.narg(icon), archived = sqlc.arg(archived), sort_order = sqlc.arg(sort_order),
    updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListAccountsSince :many
SELECT * FROM accounts WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- GER-08: um filho aponta para um pai excluído; o servidor restaura o pai.
-- name: RestoreAccount :exec
UPDATE accounts SET deleted_at = NULL, updated_at = GREATEST(updated_at + interval '1 millisecond', sqlc.arg(at)::timestamptz), server_version = 0
WHERE id = sqlc.arg(id) AND deleted_at IS NOT NULL;

-- Categorias
-- name: GetCategory :one
SELECT * FROM categories WHERE id = sqlc.arg(id);

-- name: InsertCategory :exec
INSERT INTO categories (id, user_id, name, type, icon, color, sort_order, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(type), sqlc.arg(icon), sqlc.arg(color), sqlc.arg(sort_order),
        sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateCategory :exec
UPDATE categories
SET name = sqlc.arg(name), icon = sqlc.arg(icon), color = sqlc.arg(color), sort_order = sqlc.arg(sort_order),
    updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListCategoriesSince :many
SELECT * FROM categories WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- name: RestoreCategory :exec
UPDATE categories SET deleted_at = NULL, updated_at = GREATEST(updated_at + interval '1 millisecond', sqlc.arg(at)::timestamptz), server_version = 0
WHERE id = sqlc.arg(id) AND deleted_at IS NOT NULL;

-- Investimentos
-- name: GetInvestment :one
SELECT * FROM investments WHERE id = sqlc.arg(id);

-- name: InsertInvestment :exec
INSERT INTO investments (id, user_id, name, asset_class, ticker, account_id, notes, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(asset_class), sqlc.narg(ticker), sqlc.narg(account_id), sqlc.narg(notes),
        sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateInvestment :exec
UPDATE investments
SET name = sqlc.arg(name), asset_class = sqlc.arg(asset_class), ticker = sqlc.narg(ticker), account_id = sqlc.narg(account_id),
    notes = sqlc.narg(notes), updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListInvestmentsSince :many
SELECT * FROM investments WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- name: RestoreInvestment :exec
UPDATE investments SET deleted_at = NULL, updated_at = GREATEST(updated_at + interval '1 millisecond', sqlc.arg(at)::timestamptz), server_version = 0
WHERE id = sqlc.arg(id) AND deleted_at IS NOT NULL;

-- INV-06: excluir o ativo exclui movimentos e snapshots na mesma transação.
-- name: CascadeDeleteMovements :exec
UPDATE investment_movements
SET deleted_at = sqlc.arg(deleted_at), updated_at = GREATEST(updated_at + interval '1 millisecond', sqlc.arg(at)::timestamptz), server_version = 0
WHERE investment_id = sqlc.arg(investment_id) AND deleted_at IS NULL;

-- name: CascadeDeleteSnapshots :exec
UPDATE investment_snapshots
SET deleted_at = sqlc.arg(deleted_at), updated_at = GREATEST(updated_at + interval '1 millisecond', sqlc.arg(at)::timestamptz), server_version = 0
WHERE investment_id = sqlc.arg(investment_id) AND deleted_at IS NULL;

-- Movimentos (quantity trafega como texto para não perder casas decimais)
-- name: GetMovement :one
SELECT id, user_id, investment_id, type, date, quantity::text AS quantity, amount_cents, account_id,
       created_at, updated_at, deleted_at, server_version
FROM investment_movements WHERE id = sqlc.arg(id);

-- name: InsertMovement :exec
INSERT INTO investment_movements (id, user_id, investment_id, type, date, quantity, amount_cents, account_id, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(investment_id), sqlc.arg(type), sqlc.arg(date), sqlc.arg(quantity)::text::numeric,
        sqlc.arg(amount_cents), sqlc.narg(account_id), sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateMovement :exec
UPDATE investment_movements
SET investment_id = sqlc.arg(investment_id), type = sqlc.arg(type), date = sqlc.arg(date), quantity = sqlc.arg(quantity)::text::numeric,
    amount_cents = sqlc.arg(amount_cents), account_id = sqlc.narg(account_id),
    updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListMovementsSince :many
SELECT id, user_id, investment_id, type, date, quantity::text AS quantity, amount_cents, account_id,
       created_at, updated_at, deleted_at, server_version
FROM investment_movements WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- Posição do ativo (INV-13): movimentos ativos na ordem em que valem, aporte antes de resgate no mesmo dia.
-- name: ListActiveMovementsOfInvestment :many
SELECT id, type, quantity::text AS quantity
FROM investment_movements
WHERE investment_id = sqlc.arg(investment_id) AND deleted_at IS NULL
ORDER BY date, (type = 'aporte') DESC, created_at, id;

-- Snapshots
-- name: GetSnapshot :one
SELECT * FROM investment_snapshots WHERE id = sqlc.arg(id);

-- name: InsertSnapshot :exec
INSERT INTO investment_snapshots (id, user_id, investment_id, date, value_cents, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(investment_id), sqlc.arg(date), sqlc.arg(value_cents),
        sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateSnapshot :exec
UPDATE investment_snapshots
SET investment_id = sqlc.arg(investment_id), date = sqlc.arg(date), value_cents = sqlc.arg(value_cents),
    updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListSnapshotsSince :many
SELECT * FROM investment_snapshots WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- Transações
-- name: GetTransaction :one
SELECT * FROM transactions WHERE id = sqlc.arg(id);

-- name: InsertTransaction :exec
INSERT INTO transactions (id, user_id, type, amount_cents, description, date, account_id, category_id, notes, transfer_id,
                          investment_movement_id, created_at, updated_at, deleted_at, server_version)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(type), sqlc.arg(amount_cents), sqlc.narg(description), sqlc.arg(date),
        sqlc.arg(account_id), sqlc.narg(category_id), sqlc.narg(notes), sqlc.narg(transfer_id), sqlc.narg(investment_movement_id),
        sqlc.arg(created_at), sqlc.arg(updated_at), sqlc.narg(deleted_at), 0);

-- name: UpdateTransaction :exec
UPDATE transactions
SET type = sqlc.arg(type), amount_cents = sqlc.arg(amount_cents), description = sqlc.narg(description), date = sqlc.arg(date),
    account_id = sqlc.arg(account_id), category_id = sqlc.narg(category_id), notes = sqlc.narg(notes),
    transfer_id = sqlc.narg(transfer_id), investment_movement_id = sqlc.narg(investment_movement_id),
    updated_at = sqlc.arg(updated_at), deleted_at = sqlc.narg(deleted_at), server_version = 0
WHERE id = sqlc.arg(id);

-- name: ListTransactionsSince :many
SELECT * FROM transactions WHERE server_version > sqlc.arg(since) ORDER BY server_version LIMIT sqlc.arg(lim);

-- Checagens de fim de lote (SYN-05).
-- name: ListTransactionsByTransfer :many
SELECT * FROM transactions WHERE transfer_id = sqlc.arg(transfer_id);

-- name: ListTransactionsByMovement :many
SELECT * FROM transactions WHERE investment_movement_id = sqlc.arg(movement_id);

-- name: CountActiveTransactionsOfAccount :one
SELECT count(*)::int FROM transactions WHERE account_id = sqlc.arg(account_id) AND deleted_at IS NULL;

-- name: CountActiveInvestmentsOfAccount :one
SELECT count(*)::int FROM investments WHERE account_id = sqlc.arg(account_id) AND deleted_at IS NULL;

-- name: CountActiveMovementsOfAccount :one
SELECT count(*)::int FROM investment_movements WHERE account_id = sqlc.arg(account_id) AND deleted_at IS NULL;

-- name: CountActiveTransactionsOfCategory :one
SELECT count(*)::int FROM transactions WHERE category_id = sqlc.arg(category_id) AND deleted_at IS NULL;

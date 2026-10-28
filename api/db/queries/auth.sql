-- Consultas do módulo de autenticação. Rodam com o papel prumo_auth (PER-07).

-- name: CreateUser :one
INSERT INTO users (id, email, password_hash)
VALUES (sqlc.arg(id), sqlc.arg(email), sqlc.narg(password_hash))
RETURNING *;

-- name: GetUserByEmail :one
SELECT * FROM users WHERE email = sqlc.arg(email);

-- name: GetUserByID :one
SELECT * FROM users WHERE id = sqlc.arg(id);

-- name: CreateSession :one
INSERT INTO sessions (id, user_id, refresh_hash, device, expires_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(refresh_hash), sqlc.narg(device), sqlc.arg(expires_at))
RETURNING *;

-- name: GetSessionByRefreshHash :one
SELECT * FROM sessions WHERE refresh_hash = sqlc.arg(refresh_hash);

-- name: GetSessionByPrevRefreshHash :one
SELECT * FROM sessions WHERE prev_refresh_hash = sqlc.arg(prev_refresh_hash);

-- name: GetSession :one
SELECT * FROM sessions WHERE id = sqlc.arg(id);

-- Rotação do refresh token (AUT-15). O WHERE no hash atual faz da troca uma
-- compare-and-swap: se outra requisição rotacionou antes, nenhuma linha muda.
-- name: RotateSession :one
UPDATE sessions
SET prev_refresh_hash = refresh_hash,
    prev_valid_until  = sqlc.arg(prev_valid_until),
    refresh_hash      = sqlc.arg(new_refresh_hash),
    last_used_at      = sqlc.arg(now)
WHERE id = sqlc.arg(id) AND refresh_hash = sqlc.arg(old_refresh_hash) AND revoked_at IS NULL
RETURNING *;

-- name: RevokeSession :execrows
UPDATE sessions SET revoked_at = sqlc.arg(now)
WHERE id = sqlc.arg(id) AND user_id = sqlc.arg(user_id) AND revoked_at IS NULL;

-- name: RevokeSessionByID :exec
UPDATE sessions SET revoked_at = sqlc.arg(now)
WHERE id = sqlc.arg(id) AND revoked_at IS NULL;

-- name: RevokeOtherSessions :execrows
UPDATE sessions SET revoked_at = sqlc.arg(now)
WHERE user_id = sqlc.arg(user_id) AND id <> sqlc.arg(keep_id) AND revoked_at IS NULL;

-- name: ListActiveSessions :many
SELECT * FROM sessions
WHERE user_id = sqlc.arg(user_id)
  AND revoked_at IS NULL
  AND expires_at > sqlc.arg(now)
  AND last_used_at > sqlc.arg(idle_cutoff)
ORDER BY last_used_at DESC;

-- name: InsertSecurityEvent :exec
INSERT INTO security_events (user_id, kind, ip, user_agent, metadata)
VALUES (sqlc.narg(user_id), sqlc.arg(kind), sqlc.narg(ip), sqlc.narg(user_agent), sqlc.arg(metadata));

-- Limite de login (AUT-11): falhas por e-mail + IP e por IP, contadas no próprio log
-- de segurança, então o limite vale entre instâncias da API e reinícios.
-- name: CountLoginFailuresForEmailIP :one
SELECT count(*)::int AS failures, min(created_at)::timestamptz AS oldest
FROM security_events
WHERE kind = 'login_failed'
  AND ip = sqlc.arg(ip)::inet
  AND metadata->>'email_hash' = sqlc.arg(email_hash)::text
  AND created_at > sqlc.arg(since);

-- name: CountLoginFailuresForIP :one
SELECT count(*)::int AS failures, min(created_at)::timestamptz AS oldest
FROM security_events
WHERE kind = 'login_failed'
  AND ip = sqlc.arg(ip)::inet
  AND created_at > sqlc.arg(since);

-- Cadastro (AUT-06): linhas criadas com app.user_id definido, sob RLS.
-- name: CreateProfile :exec
INSERT INTO profiles (id, user_id, name, created_at, updated_at)
VALUES (sqlc.arg(user_id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(now), sqlc.arg(now));

-- name: CreateAccount :exec
INSERT INTO accounts (id, user_id, name, type, initial_balance_cents, color, icon, sort_order, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(type), 0, sqlc.arg(color), sqlc.narg(icon), sqlc.arg(sort_order), sqlc.arg(now), sqlc.arg(now));

-- name: CreateCategory :exec
INSERT INTO categories (id, user_id, name, type, icon, color, sort_order, created_at, updated_at)
VALUES (sqlc.arg(id), sqlc.arg(user_id), sqlc.arg(name), sqlc.arg(type), sqlc.arg(icon), sqlc.arg(color), sqlc.arg(sort_order), sqlc.arg(now), sqlc.arg(now));

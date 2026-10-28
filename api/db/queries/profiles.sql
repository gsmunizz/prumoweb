-- Toda consulta recebe user_id e filtra por ele (PER-02), além do RLS (PER-06).

-- name: GetProfile :one
SELECT * FROM profiles
WHERE user_id = sqlc.arg(user_id);

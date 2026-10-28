#!/bin/sh
# Init do container Postgres de desenvolvimento: cria os papéis, sem senha.
# O container local aceita conexões sem senha (trust) e só escuta em 127.0.0.1.
# Em produção, rode db/bootstrap.sql com as senhas (veja o cabeçalho dele).
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /bootstrap.sql

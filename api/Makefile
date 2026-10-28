# Atalhos de desenvolvimento da API. Variáveis vêm do .env (veja .env.example).
-include .env
export

.PHONY: run test test-integration lint generate migrate-up migrate-down migrate-new

run:
	go run ./cmd/api

test:
	go test ./...

# Precisa do banco do docker compose no ar com as migrações aplicadas.
test-integration:
	TEST_DATABASE_URL="$(DATABASE_URL)" TEST_AUTH_DATABASE_URL="$(AUTH_DATABASE_URL)" go test -count=1 ./...

lint:
	golangci-lint run ./...
	go run golang.org/x/vuln/cmd/govulncheck@v1.7.0 ./...

# Gera internal/store a partir de db/queries e do esquema das migrações.
generate:
	go run github.com/sqlc-dev/sqlc/cmd/sqlc@v1.30.0 generate

migrate-up:
	migrate -path db/migrations -database "$(MIGRATE_DATABASE_URL)" up

migrate-down:
	migrate -path db/migrations -database "$(MIGRATE_DATABASE_URL)" down 1

# make migrate-new name=add_budgets
migrate-new:
	migrate create -ext sql -dir db/migrations -seq $(name)

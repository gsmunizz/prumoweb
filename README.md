# Prumo

Controle financeiro pessoal: PWA mobile-first que responde quanto dinheiro você tem, quanto gastou, com o quê, como o saldo evolui e como estão os investimentos.

O app é local-first. A interface lê e grava só no banco local do navegador (IndexedDB) e uma fila sincroniza com a API em segundo plano, então registrar uma despesa nunca espera a rede.

## Estrutura

| Pasta                | O que tem                                                                                                                             |
|----------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| `web/`               | PWA em React, TypeScript e Vite; Tailwind com os tokens do design system; Dexie (IndexedDB); TanStack Router e Query; vite-plugin-pwa |
| `api/`               | API em Go com Gin; Postgres via pgx e sqlc; migrações com golang-migrate                                                              |
| `api/db/migrations/` | Esquema do banco, com Row Level Security em toda tabela financeira                                                                    |
| `api/db/queries/`    | SQL das consultas; o sqlc gera `api/internal/store` a partir delas                                                                    |
| `docker-compose.yml` | Postgres 16, migrações e API para desenvolvimento                                                                                     |

As regras de negócio têm códigos (por exemplo `TRX-04`, `PER-06`) definidos no documento "Prumo — Regras de negócio e rotas do backend". Código, testes e commits citam esses códigos.

## Rodando localmente

Requisitos: Docker, Go 1.26+, Node 22+ e, para criar migrações, o CLI [`migrate`](https://github.com/golang-migrate/migrate/tree/master/cmd/migrate).

```sh
# 1. Banco e migrações
docker compose up -d db migrate

# 2. API em http://localhost:8080
cd api
cp .env.example .env
make run

# 3. App em http://localhost:5173 (o Vite repassa /api para a API)
cd web
npm install
npm run dev
```

Para subir tudo em containers: `docker compose up --build`.

Confira em `curl localhost:8080/api/v1/health`, que deve responder `{"status":"ok", ...}`.

## Testes

```sh
cd web && npm test && npm run typecheck
cd api && make test                # unitários
cd api && make test-integration    # inclui RLS e papéis; precisa do banco do compose
cd api && make lint                # golangci-lint e govulncheck
```

O CI (`.github/workflows/ci.yml`) roda tudo isso em cada PR, com um Postgres de verdade, e confere que o código do sqlc está atualizado e que a migração volta e sobe de novo.

## Banco de dados e segurança

A API conecta com três papéis diferentes, criados por `api/db/bootstrap.sql`:

| Papel         | Usado por              | Pode                                                                         |
|---------------|------------------------|------------------------------------------------------------------------------|
| `prumo_owner` | migrações              | é dono das tabelas                                                           |
| `prumo_app`   | rotas de dados         | tabelas financeiras, sempre sob RLS (`NOBYPASSRLS`)                          |
| `prumo_auth`  | módulo de autenticação | tabelas de login e sessão; só insere perfil, contas e categorias no cadastro |

Toda requisição autenticada roda numa transação com `SET LOCAL app.user_id` (`database.WithUser`), e as políticas de RLS só liberam linhas desse usuário. Se o código esquecer de definir o usuário, a consulta volta vazia em vez de vazar dados. Os testes em `api/internal/database/rls_test.go` provam isso contra o banco.

Valores em dinheiro são sempre centavos inteiros (`*_cents`). IDs são UUIDs gerados no cliente, para o app funcionar offline. Exclusão é lógica (`deleted_at`), e toda escrita ganha um `server_version` novo, que é o cursor do sync.

## Autenticação

A API tem autenticação própria (regras `AUT-*` do documento de regras). Rotas em `/api/v1`:

| Rota                                                        | O que faz                                                                                                          |
|-------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|
| `POST /auth/register`                                       | cria usuário, perfil, 18 categorias padrão e a conta Carteira numa transação; abre a sessão                        |
| `POST /auth/login`                                          | e-mail e senha; no máximo 5 falhas em 15 min por e-mail + IP                                                       |
| `POST /auth/refresh`                                        | troca o refresh token do cookie por outro e emite um token de acesso                                               |
| `POST /auth/logout`                                         | revoga a sessão e apaga o cookie                                                                                   |
| `GET /auth/sessions`, `DELETE /auth/sessions[/{id}]`        | lista e revoga sessões do próprio usuário                                                                          |
| `GET /me`                                                   | usuário e perfil                                                                                                   |
| `POST /auth/verify-email`, `POST /auth/verify-email/resend` | confirma o e-mail pelo link (24 h); reenvio limitado a 3 por hora                                                  |
| `POST /auth/password/forgot`, `POST /auth/password/reset`   | redefinição por link (1 h, uso único); `forgot` sempre responde 202; reset encerra todas as sessões                |
| `POST /auth/reauth`                                         | confirma a senha por 5 minutos, exigido para trocar o e-mail (quem só tem Google usa `google/start?intent=reauth`) |
| `PUT /me/password`                                          | troca a senha (pede a atual) e encerra as outras sessões                                                           |
| `POST /me/email`, `POST /me/email/confirm`                  | troca de e-mail: link ao endereço novo, aviso ao antigo; exige e-mail verificado e reautenticação                  |

- **Senha:** argon2id (64 MiB, t=3, p=1), 10 a 128 caracteres, fora das senhas mais comuns.
- **Token de acesso:** JWT Ed25519 de 15 minutos, guardado só em memória no cliente.
- **Refresh token:** 32 bytes aleatórios, só o SHA-256 vai ao banco, cookie `prumo_rt` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/api/v1/auth`). Cada uso gira o token; o anterior vale por 10 s para duas abas renovando juntas, e reuso depois disso revoga a sessão inteira.
- **Sessão:** expira após 30 dias sem uso e 90 dias depois do login.
- **CSRF:** as rotas de `/auth` exigem `Origin` igual a `APP_ORIGIN` e o cabeçalho `X-Prumo-Client: web`.
- **Google (opcional, `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`):** `GET /auth/google/start?intent=login|link|reauth` redireciona ao Google (authorization code com PKCE S256, `state` e `nonce`, guardados num cookie `prumo_oidc` assinado, `HttpOnly`, `SameSite=Lax`, 10 min) e `GET /auth/google/callback` valida o `id_token` (assinatura, `iss`, `aud`, `exp`, `nonce`) e redireciona para `/auth/callback` do app, com o cookie de sessão no login ou `?error=<code>` em caso de falha. Só vale com `email_verified`; e-mail igual ao de uma conta já verificada vincula, conta não verificada pede login com senha antes (`ACCOUNT_LINK_REQUIRED`), e o primeiro acesso cria a conta como no cadastro, já verificada e sem senha. `DELETE /me/google` desvincula, desde que a conta tenha senha. Cadastre `<APP_ORIGIN>/api/v1/auth/google/callback` como URI de redirecionamento no Google.
- **E-mails:** enviados pelo Resend (`RESEND_API_KEY`, `MAIL_FROM`). Os links apontam para `APP_ORIGIN` com o token no fragmento (`/verify-email#token=...`, `/reset-password#token=...`, `/confirm-email#token=...`), e só o SHA-256 do token fica no banco. Sem a chave, em desenvolvimento, a mensagem inteira sai no log. O remetente de teste do Resend só entrega ao dono da conta; para outros destinatários é preciso verificar um domínio e trocar `MAIL_FROM`.
- **Cadastro:** `REGISTRATION_MODE=invite` (padrão) só aceita e-mails de `ALLOWED_EMAILS`.

Antes de subir em produção, gere a chave de assinatura com `go run ./cmd/keygen` e guarde `AUTH_SIGNING_KEY` no cofre do provedor. Veja `api/.env.example` para a rotação de chave e `TRUSTED_PROXIES`.

## Sync

O app grava só no IndexedDB e uma fila sincroniza com a API (regras `SYN-*`). Duas rotas, ambas com token de acesso:

| Rota                                | O que faz                                                                                                                                                                                                       |
|-------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `POST /sync/push`                   | `{ device_id, ops: [{ op_id, entity, id, updated_at, data }] }`, até 500 operações e 5 MB; 60 pushes por minuto por usuário. Devolve `{ results: [{ op_id, status, code?, details?, current? }], server_time }` |
| `GET /sync/pull?since=0&limit=1000` | `{ changes: { <entidade>: [registro] }, next_since, has_more, server_time }`, com todas as sete entidades sempre presentes, inclusive registros excluídos                                                       |

- **Entidades:** `profile`, `accounts`, `categories`, `transactions`, `investments`, `investment_movements`, `investment_snapshots`. `data` leva o registro inteiro (a escrita nunca é parcial) e excluir é a mesma operação com `deleted_at` preenchido. O formato do pull é o do campo `data`, mais `created_at`, `updated_at`, `deleted_at` e `server_version`.
- **Last-write-wins:** vence o maior `updated_at`; empate fica com o servidor. Um `updated_at` mais de 5 minutos no futuro vira a hora do servidor (GER-05). Resultado por operação: `applied`, `stale` (com o registro do servidor em `current`) ou `rejected` (com `code` e `details`). Reenviar um lote não duplica nada: o id é do cliente.
- **Ordem do lote:** as operações valem em sequência, então "mover as transações e excluir a conta" cabe num lote só. Cada operação roda num savepoint, e uma recusa não derruba as outras.
- **Regras entre registros** (transferências, aporte ligado a conta, posição do ativo, conta e categoria em uso) são conferidas ao fim do lote; se falham, as operações envolvidas viram `rejected` e o resto do lote é refeito sem elas.
- **Pais excluídos:** um registro que aponta para conta, categoria ou ativo excluído não é recusado; o servidor restaura o pai (com `updated_at` maior que o da exclusão) e o devolve no próximo pull (GER-08). Excluir um ativo exclui seus movimentos e snapshots, mas não as transações de conta ligadas aos aportes (INV-06).
- **Cursor:** `server_version` vem de uma sequência do Postgres, e o push de cada usuário roda sob um advisory lock, então as versões confirmam na ordem em que foram geradas e um pull nunca pula um registro. `next_since` é o maior `server_version` da página. Cursor menor que `sync_state.purged_through` responde `410 SYNC_RESET_REQUIRED` (SYN-09); a rotina diária que apaga excluídos de verdade (GER-07) ainda não existe.
- **Snapshots:** o `id` é `UUID v5` do namespace `7d1c5b2e-4f3a-4a6b-9c8d-0e1f2a3b4c5d` com o nome `"<investment_id>:<AAAA-MM-DD>"`, igual no cliente e na API (INV-21). `quantity` dos movimentos trafega como texto decimal, com até 8 casas.

## Novas migrações e consultas

```sh
cd api
make migrate-new name=add_budgets   # cria NNNNNN_add_budgets.up.sql e .down.sql
make migrate-up
make generate                       # depois de mudar db/queries ou o esquema
```

## Deploy

Ainda não configurado. O plano é o frontend na Vercel ou no Cloudflare Pages, com rewrite de `/api/*` para a API (mesmo caminho, mesma origem, sem CORS), e a API em container Docker (`api/Dockerfile`) num provedor no Brasil, com Postgres gerenciado. No MVP o app fica no endereço do host; um domínio próprio entra só trocando `APP_ORIGIN`.

## Roadmap

- **Fase 0 — Fundação:** repositório, CI, API, banco, tokens do design, autenticação própria e sync. Termina com login e sincronização funcionando de ponta a ponta.
- **Fase 1 — MVP pessoal:** transações, contas, categorias, dashboard, calendário, investimentos, offline, configurações, exportação.
- **Fase 2 — Hábito e automação:** orçamentos, recorrência, importação CSV/OFX, cotações, fatura de cartão.
- **Fase 3 — Abertura:** cadastro público, Open Finance, notificações.

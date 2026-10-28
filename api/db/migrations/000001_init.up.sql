-- Modelo inicial do Prumo, conforme "Prumo — Regras de negócio e rotas do backend".
-- Roda como prumo_owner. Os papéis prumo_app e prumo_auth vêm do db/bootstrap.sql.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ---------------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------------

-- Usuário da requisição, definido pela API com SET LOCAL app.user_id (PER-05).
-- Sem valor (ou com string vazia, que é o que sobra na sessão depois de um
-- SET LOCAL), devolve nulo e nenhuma política libera linha alguma.
CREATE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

-- unaccent não é IMMUTABLE; este invólucro permite o índice de busca (TRX-15).
CREATE FUNCTION search_text(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT lower(public.unaccent('public.unaccent'::regdictionary, $1))
$$;

-- Cursor do pull (SYN-07): toda escrita em registro sincronizado ganha um novo valor.
CREATE SEQUENCE sync_version AS bigint;

CREATE FUNCTION bump_server_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.server_version := nextval('sync_version');
  RETURN NEW;
END
$$;

-- ---------------------------------------------------------------------------
-- Autenticação (AUT-*). Acessadas só pelo papel prumo_auth (PER-07).
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             citext NOT NULL UNIQUE CHECK (length(email) <= 254),
  email_verified_at timestamptz,
  -- Hash argon2id no formato PHC, com os parâmetros junto (AUT-04). Nulo em conta só Google.
  password_hash     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('google')),
  subject    text NOT NULL,
  email      citext NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

CREATE TABLE sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 do refresh token atual (AUT-13) e do anterior, aceito por 10 s (AUT-15).
  refresh_hash        bytea NOT NULL UNIQUE,
  prev_refresh_hash   bytea,
  prev_valid_until    timestamptz,
  device              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_used_at        timestamptz NOT NULL DEFAULT now(),
  -- Limite absoluto de 90 dias depois do login; a ociosidade de 30 dias sai de last_used_at (AUT-14).
  expires_at          timestamptz NOT NULL,
  reauth_at           timestamptz,
  revoked_at          timestamptz
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;
CREATE INDEX sessions_prev_refresh_idx ON sessions (prev_refresh_hash) WHERE prev_refresh_hash IS NOT NULL;

-- Links enviados por e-mail: verificação, redefinição de senha, troca de e-mail.
CREATE TABLE auth_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  purpose     text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password', 'change_email')),
  token_hash  bytea NOT NULL UNIQUE,
  new_email   citext,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((purpose = 'change_email') = (new_email IS NOT NULL))
);
CREATE INDEX auth_tokens_user_idx ON auth_tokens (user_id, purpose);

-- Log de segurança, guardado por 1 ano (PER-10). Sobrevive à exclusão da conta
-- com user_id nulo, para manter o rastro de acesso exigido pelo Marco Civil.
CREATE TABLE security_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  kind       text NOT NULL,
  ip         inet,
  user_agent text,
  metadata   jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX security_events_user_idx ON security_events (user_id, created_at DESC);
CREATE INDEX security_events_created_idx ON security_events (created_at);

-- ---------------------------------------------------------------------------
-- Registros sincronizados (GER-01, SYN-01).
-- Todos têm id do cliente, user_id, created_at, updated_at (relógio do aparelho,
-- usado no last-write-wins), deleted_at e server_version.
-- Referências entre registros usam (id, user_id), para o banco garantir que
-- nenhum registro aponte para dado de outro usuário (GER-09).
-- ---------------------------------------------------------------------------

CREATE TABLE profiles (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  currency       text NOT NULL DEFAULT 'BRL' CHECK (currency = 'BRL'),
  timezone       text NOT NULL DEFAULT 'America/Sao_Paulo',
  theme          text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  deleted_at     timestamptz,
  server_version bigint NOT NULL,
  -- O perfil usa o próprio user_id como id (SYN-01).
  CHECK (id = user_id)
);

CREATE TABLE accounts (
  id                    uuid PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                  text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  type                  text NOT NULL CHECK (type IN ('corrente', 'poupanca', 'carteira', 'digital', 'corretora', 'cartao_credito')),
  initial_balance_cents bigint NOT NULL DEFAULT 0 CHECK (initial_balance_cents BETWEEN -99999999999 AND 99999999999),
  color                 text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  icon                  text,
  archived              boolean NOT NULL DEFAULT false,
  sort_order            integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL,
  updated_at            timestamptz NOT NULL,
  deleted_at            timestamptz,
  server_version        bigint NOT NULL,
  UNIQUE (id, user_id)
);

CREATE TABLE categories (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 30),
  type           text NOT NULL CHECK (type IN ('income', 'expense')),
  icon           text NOT NULL,
  color          text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order     integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  deleted_at     timestamptz,
  server_version bigint NOT NULL,
  UNIQUE (id, user_id),
  -- Permite à transação exigir categoria do mesmo tipo (TRX-04).
  UNIQUE (id, user_id, type)
);

CREATE TABLE investments (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name           text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  asset_class    text NOT NULL CHECK (asset_class IN ('renda_fixa', 'acoes', 'fiis', 'etfs', 'cripto', 'outros')),
  ticker         text CHECK (ticker ~ '^[A-Z0-9.-]{1,12}$'),
  account_id     uuid,
  notes          text CHECK (char_length(notes) <= 1000),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  deleted_at     timestamptz,
  server_version bigint NOT NULL,
  UNIQUE (id, user_id),
  FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id)
);

CREATE TABLE investment_movements (
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  investment_id  uuid NOT NULL,
  type           text NOT NULL CHECK (type IN ('aporte', 'resgate')),
  date           date NOT NULL,
  quantity       numeric(28, 8) NOT NULL CHECK (quantity > 0),
  amount_cents   bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999),
  account_id     uuid,
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  deleted_at     timestamptz,
  server_version bigint NOT NULL,
  UNIQUE (id, user_id),
  FOREIGN KEY (investment_id, user_id) REFERENCES investments (id, user_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id)
);

CREATE TABLE investment_snapshots (
  -- UUID v5 de investment_id + data, calculado igual no cliente e na API (INV-21).
  id             uuid PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  investment_id  uuid NOT NULL,
  date           date NOT NULL,
  value_cents    bigint NOT NULL CHECK (value_cents BETWEEN 0 AND 99999999999),
  created_at     timestamptz NOT NULL,
  updated_at     timestamptz NOT NULL,
  deleted_at     timestamptz,
  server_version bigint NOT NULL,
  UNIQUE (investment_id, date),
  FOREIGN KEY (investment_id, user_id) REFERENCES investments (id, user_id) ON DELETE CASCADE
);

CREATE TABLE transactions (
  id                     uuid PRIMARY KEY,
  user_id                uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  type                   text NOT NULL CHECK (type IN ('income', 'expense')),
  amount_cents           bigint NOT NULL CHECK (amount_cents BETWEEN 1 AND 99999999999),
  description            text CHECK (char_length(description) <= 140),
  date                   date NOT NULL CHECK (date >= DATE '2000-01-01'),
  account_id             uuid NOT NULL,
  category_id            uuid,
  notes                  text CHECK (char_length(notes) <= 1000),
  transfer_id            uuid,
  investment_movement_id uuid,
  created_at             timestamptz NOT NULL,
  updated_at             timestamptz NOT NULL,
  deleted_at             timestamptz,
  server_version         bigint NOT NULL,
  FOREIGN KEY (account_id, user_id) REFERENCES accounts (id, user_id),
  FOREIGN KEY (category_id, user_id, type) REFERENCES categories (id, user_id, type),
  FOREIGN KEY (investment_movement_id, user_id) REFERENCES investment_movements (id, user_id) ON DELETE CASCADE,
  -- Movimentação interna não tem categoria; receita ou despesa comum tem (TRX-04, TRX-11).
  CHECK ((transfer_id IS NULL AND investment_movement_id IS NULL) = (category_id IS NOT NULL)),
  CHECK (transfer_id IS NULL OR investment_movement_id IS NULL)
);

CREATE INDEX transactions_user_date_idx ON transactions (user_id, date DESC, created_at DESC);
CREATE INDEX transactions_user_category_idx ON transactions (user_id, category_id);
CREATE INDEX transactions_user_account_idx ON transactions (user_id, account_id);
CREATE INDEX transactions_transfer_idx ON transactions (transfer_id) WHERE transfer_id IS NOT NULL;
CREATE INDEX transactions_movement_idx ON transactions (investment_movement_id) WHERE investment_movement_id IS NOT NULL;
CREATE INDEX transactions_search_idx ON transactions
  USING gin (search_text(coalesce(description, '') || ' ' || coalesce(notes, '')) gin_trgm_ops);
CREATE INDEX investment_movements_investment_idx ON investment_movements (investment_id, date);
CREATE INDEX investments_account_idx ON investments (account_id) WHERE account_id IS NOT NULL;
CREATE INDEX investment_movements_account_idx ON investment_movements (account_id) WHERE account_id IS NOT NULL;

-- Em cada tabela sincronizada: gatilho do server_version, índice do pull,
-- índice da limpeza de excluídos (GER-07) e RLS forçado (PER-06).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'accounts', 'categories', 'transactions',
                           'investments', 'investment_movements', 'investment_snapshots']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %I
                    FOR EACH ROW EXECUTE FUNCTION bump_server_version()', t || '_server_version', t);
    EXECUTE format('CREATE INDEX %I ON %I (user_id, server_version)', t || '_pull_idx', t);
    EXECUTE format('CREATE INDEX %I ON %I (deleted_at) WHERE deleted_at IS NOT NULL', t || '_deleted_idx', t);
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY owner_only ON %I USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO prumo_app', t);
  END LOOP;
END
$$;

-- ---------------------------------------------------------------------------
-- Permissões (PER-04, PER-07)
-- ---------------------------------------------------------------------------

GRANT USAGE ON SEQUENCE sync_version TO prumo_app, prumo_auth;
GRANT EXECUTE ON FUNCTION app_user_id(), search_text(text) TO prumo_app, prumo_auth;

GRANT SELECT, INSERT, UPDATE, DELETE ON users, identities, sessions, auth_tokens TO prumo_auth;
GRANT SELECT, INSERT ON security_events TO prumo_auth;
-- O cadastro cria perfil, categorias padrão e a conta Carteira na mesma transação
-- do usuário (AUT-06), com app.user_id definido; por isso só INSERT, sujeito ao RLS.
GRANT INSERT ON profiles, accounts, categories TO prumo_auth;
-- A API registra eventos de segurança fora do módulo de auth (ex.: exportação).
GRANT INSERT ON security_events TO prumo_app;

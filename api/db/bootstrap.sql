-- Papéis do banco do Prumo (PER-04, PER-07). Roda uma vez por banco, com um
-- superusuário ou o admin do Postgres gerenciado, antes das migrações.
--
-- prumo_owner: dono das tabelas; só as migrações conectam com ele.
-- prumo_app:   a API nas rotas de dados; sujeito ao RLS (NOBYPASSRLS).
-- prumo_auth:  o módulo de autenticação; lê as tabelas de auth e não enxerga as financeiras.
--
-- Em produção, passe as senhas (vindas do cofre do provedor, nunca do repositório):
--   psql -v owner_password=... -v app_password=... -v auth_password=... -f bootstrap.sql
-- Sem elas, os papéis ficam sem senha, o que só serve para o Postgres local do
-- docker compose e do CI, que aceitam conexões sem senha (trust).

SELECT 'CREATE ROLE prumo_owner LOGIN'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prumo_owner') \gexec
SELECT 'CREATE ROLE prumo_app LOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prumo_app') \gexec
SELECT 'CREATE ROLE prumo_auth LOGIN NOBYPASSRLS'
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'prumo_auth') \gexec

\if :{?owner_password}
SELECT format('ALTER ROLE prumo_owner PASSWORD %L', :'owner_password') \gexec
\endif
\if :{?app_password}
SELECT format('ALTER ROLE prumo_app PASSWORD %L', :'app_password') \gexec
\endif
\if :{?auth_password}
SELECT format('ALTER ROLE prumo_auth PASSWORD %L', :'auth_password') \gexec
\endif

SELECT format('GRANT ALL ON DATABASE %I TO prumo_owner', current_database()) \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO prumo_app, prumo_auth', current_database()) \gexec
GRANT ALL ON SCHEMA public TO prumo_owner;
GRANT USAGE ON SCHEMA public TO prumo_app, prumo_auth;

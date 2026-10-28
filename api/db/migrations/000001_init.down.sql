DROP TABLE IF EXISTS transactions, investment_snapshots, investment_movements, investments,
  categories, accounts, profiles, security_events, auth_tokens, sessions, identities, users;
DROP FUNCTION IF EXISTS bump_server_version();
DROP SEQUENCE IF EXISTS sync_version;
DROP FUNCTION IF EXISTS search_text(text);
DROP FUNCTION IF EXISTS app_user_id();

-- Estado global do sync (SYN-09). purged_through é o maior server_version entre os
-- registros excluídos que a limpeza diária (GER-07) apagou de verdade. Um aparelho cujo
-- cursor é menor que isso pode ter perdido exclusões e precisa baixar tudo de novo.
CREATE TABLE sync_state (
  singleton     boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  purged_through bigint NOT NULL DEFAULT 0
);
INSERT INTO sync_state (singleton) VALUES (true);

GRANT SELECT ON sync_state TO prumo_app;

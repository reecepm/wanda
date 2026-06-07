-- Migration 001 — outbox + server registry persistence.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- In-flight mutations that survived a client crash or a disconnect. Each row
-- holds enough JSON to re-execute the RPC. The `idempotency_key` is a
-- version-prefixed deterministic hash so server-side dedup survives retries
-- from any process that held the same clientId.
CREATE TABLE IF NOT EXISTS outbox (
  id              TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  method          TEXT NOT NULL,
  input_json      TEXT NOT NULL,
  ref_json        TEXT,               -- AnyResourceRef or null
  created_at      INTEGER NOT NULL,
  retries         INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT
);

CREATE INDEX IF NOT EXISTS outbox_by_created ON outbox(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_by_idempotency ON outbox(idempotency_key);

-- Paired-server registry. `serverId` is the server's self-declared identity;
-- `registry_id` is the local opaque handle consumers pass around.
CREATE TABLE IF NOT EXISTS servers (
  registry_id  TEXT PRIMARY KEY,
  server_id    TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  label        TEXT NOT NULL,
  paired_at    INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS servers_by_server_id ON servers(server_id);

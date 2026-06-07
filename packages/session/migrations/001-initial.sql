-- Migration 001 — initial session schema.
-- Idempotent so re-running is a no-op.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The server's stable identity. Exactly one row for the lifetime of a Wanda
-- install. `epoch_crc` detects torn writes on the epoch counter — mismatch
-- means the file is corrupted and we refuse to boot.
CREATE TABLE IF NOT EXISTS server_identity (
  id          TEXT PRIMARY KEY,
  created_at  INTEGER NOT NULL,
  epoch       INTEGER NOT NULL DEFAULT 1,
  epoch_crc   INTEGER NOT NULL
);

-- A paired client's persistent session. sessionToken is the long-lived bearer
-- credential stored client-side; it survives WS reconnects, app restarts, and
-- device reboots. One session per (serverId, clientId) pair.
CREATE TABLE IF NOT EXISTS sessions (
  session_id      TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL UNIQUE,
  session_token   TEXT NOT NULL UNIQUE,
  device_label    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_by_expiry ON sessions(expires_at);

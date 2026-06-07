-- Migration 001 — initial event-log schema.
-- Idempotent (IF NOT EXISTS) so reopen on already-migrated DBs is a no-op.

CREATE TABLE IF NOT EXISTS _meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  seq           INTEGER PRIMARY KEY AUTOINCREMENT,
  ts            INTEGER NOT NULL,
  epoch         INTEGER NOT NULL,
  channel       TEXT    NOT NULL,
  resource_kind TEXT    NOT NULL,
  resource_id   TEXT    NOT NULL,
  payload_json  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS events_by_resource ON events(resource_kind, resource_id, seq DESC);
CREATE INDEX IF NOT EXISTS events_by_seq_epoch ON events(epoch, seq);

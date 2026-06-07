-- Applied by runMigrations() as an idempotent compatibility patch because
-- SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Real ALTERs
-- live in `ensureCompatibilityColumns` so fresh and patched DBs converge.
SELECT 1;

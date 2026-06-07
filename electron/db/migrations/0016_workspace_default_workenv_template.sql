-- Applied by runMigrations() as an idempotent compatibility patch because
-- SQLite has no `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
SELECT 1;

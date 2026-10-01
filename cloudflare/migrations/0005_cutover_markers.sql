ALTER TABLE league_state ADD COLUMN reopened_at INTEGER;
-- statement-break
ALTER TABLE league_state ADD COLUMN new_writes_at INTEGER;
-- statement-break
ALTER TABLE league_state ADD COLUMN import_source_hash TEXT;
-- statement-break
CREATE TRIGGER mark_account_creation AFTER INSERT ON auth_user
BEGIN
  UPDATE league_state SET new_writes_at = COALESCE(new_writes_at, CAST(strftime('%s','now') AS INTEGER) * 1000), revision = revision + 1
    WHERE id = 'live' AND maintenance = 0;
END;
-- statement-break
CREATE TRIGGER mark_session_creation AFTER INSERT ON auth_session
BEGIN
  UPDATE league_state SET new_writes_at = COALESCE(new_writes_at, CAST(strftime('%s','now') AS INTEGER) * 1000), revision = revision + 1
    WHERE id = 'live' AND maintenance = 0;
END;
-- statement-break
CREATE TRIGGER mark_password_change AFTER UPDATE ON auth_account
BEGIN
  UPDATE league_state SET new_writes_at = COALESCE(new_writes_at, CAST(strftime('%s','now') AS INTEGER) * 1000), revision = revision + 1
    WHERE id = 'live' AND maintenance = 0;
END;

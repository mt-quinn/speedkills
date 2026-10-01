-- Native Better Auth dates are ISO strings; game timestamps remain epoch milliseconds.
DROP TRIGGER provision_player;
-- statement-break

CREATE TRIGGER provision_player AFTER INSERT ON auth_user
BEGIN
  SELECT RAISE(ABORT, 'This progress already belongs to an account') WHERE EXISTS (
    SELECT 1 FROM players WHERE legacy_token_hash = NEW.legacyClaimHash AND user_id IS NOT NULL
  );
  UPDATE players SET user_id = NEW.id, name = NEW.name, legacy_token_hash = NULL
    WHERE legacy_token_hash = NEW.legacyClaimHash AND user_id IS NULL;
  INSERT INTO players(id, user_id, name, balance, created_at)
    SELECT NEW.id, NEW.id, NEW.name, 50000, COALESCE(CAST(ROUND((julianday(NEW.createdAt) - 2440587.5) * 86400000) AS INTEGER), CAST(NEW.createdAt AS INTEGER))
    WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = NEW.id);
  INSERT INTO ledger(id, player_id, kind, amount, balance, note, effect_key, created_at)
    SELECT 'welcome:' || NEW.id, id, 'welcome', 50000, 50000, 'Welcome credits',
      'welcome:' || NEW.id, COALESCE(CAST(ROUND((julianday(NEW.createdAt) - 2440587.5) * 86400000) AS INTEGER), CAST(NEW.createdAt AS INTEGER)) FROM players
    WHERE user_id = NEW.id AND id = NEW.id;
END;

-- statement-break
UPDATE players SET created_at = CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) WHERE typeof(created_at) = 'text';
-- statement-break
UPDATE ledger SET created_at = CAST(ROUND((julianday(created_at) - 2440587.5) * 86400000) AS INTEGER) WHERE typeof(created_at) = 'text';
-- statement-break
CREATE TABLE command_rates (actor_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);

-- Better Auth 1.7.7 native D1 tables. Credentials are imported unchanged.
CREATE TABLE auth_user (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  emailVerified INTEGER NOT NULL DEFAULT 0, image TEXT, createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  displayUsername TEXT, legacyClaimHash TEXT
);
-- statement-break
CREATE TABLE auth_session (
  id TEXT PRIMARY KEY, expiresAt INTEGER NOT NULL, token TEXT NOT NULL UNIQUE,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, ipAddress TEXT, userAgent TEXT,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE
);
-- statement-break
CREATE INDEX auth_session_user ON auth_session(userId);
-- statement-break
CREATE TABLE auth_account (
  id TEXT PRIMARY KEY, accountId TEXT NOT NULL, providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  accessToken TEXT, refreshToken TEXT, idToken TEXT, accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER, scope TEXT, password TEXT,
  createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL, UNIQUE(providerId, accountId)
);
-- statement-break
CREATE INDEX auth_account_user ON auth_account(userId);
-- statement-break
CREATE TABLE auth_verification (
  id TEXT PRIMARY KEY, identifier TEXT NOT NULL, value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
-- statement-break
CREATE INDEX auth_verification_identifier ON auth_verification(identifier);
-- statement-break
CREATE TABLE auth_rate_limit (
  id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE, count INTEGER NOT NULL, lastRequest INTEGER NOT NULL
);
-- statement-break
-- A user insert and its player claim/welcome ledger are one SQLite statement.
-- A claimed token stays recorded on auth_user, so another signup cannot grant a
-- second wallet after the bearer secret is erased from players.
CREATE UNIQUE INDEX auth_claim_once ON auth_user(legacyClaimHash) WHERE legacyClaimHash IS NOT NULL;
-- statement-break
CREATE TRIGGER provision_player AFTER INSERT ON auth_user
BEGIN
  SELECT RAISE(ABORT, 'This progress already belongs to an account') WHERE EXISTS (
    SELECT 1 FROM players WHERE legacy_token_hash = NEW.legacyClaimHash AND user_id IS NOT NULL
  );
  UPDATE players SET user_id = NEW.id, name = NEW.name, legacy_token_hash = NULL
    WHERE legacy_token_hash = NEW.legacyClaimHash AND user_id IS NULL;
  INSERT INTO players(id, user_id, name, balance, created_at)
    SELECT NEW.id, NEW.id, NEW.name, 50000, NEW.createdAt
    WHERE NOT EXISTS (SELECT 1 FROM players WHERE user_id = NEW.id);
  INSERT INTO ledger(id, player_id, kind, amount, balance, note, effect_key, created_at)
    SELECT 'welcome:' || NEW.id, id, 'welcome', 50000, 50000, 'Welcome credits',
      'welcome:' || NEW.id, NEW.createdAt FROM players
    WHERE user_id = NEW.id AND id = NEW.id;
END;

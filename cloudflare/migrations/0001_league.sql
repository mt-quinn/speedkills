PRAGMA foreign_keys = ON;

-- Auth implementation/provider tables are a separate migration after compatibility proof.
CREATE TABLE players (
  id TEXT PRIMARY KEY, user_id TEXT UNIQUE, legacy_token_hash TEXT UNIQUE,
  name TEXT NOT NULL, balance INTEGER NOT NULL CHECK (balance >= 0 AND balance % 100 = 0),
  last_chat INTEGER NOT NULL DEFAULT 0, last_recovery INTEGER NOT NULL DEFAULT 0,
  candidate_json TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX players_balance ON players(balance);
CREATE TABLE ships (
  id TEXT PRIMARY KEY, owner_id TEXT UNIQUE REFERENCES players(id),
  name TEXT NOT NULL, style TEXT NOT NULL, identity INTEGER NOT NULL,
  revision INTEGER NOT NULL, crew_json TEXT NOT NULL, roster_index INTEGER,
  testing INTEGER NOT NULL DEFAULT 0, earnings INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0, fights INTEGER NOT NULL DEFAULT 0,
  last_fight INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE fights (
  id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE,
  ships_json TEXT NOT NULL, odds_json TEXT NOT NULL, odds_samples INTEGER NOT NULL,
  odds_key TEXT NOT NULL, seed INTEGER NOT NULL, duration REAL NOT NULL,
  winner INTEGER CHECK (winner IS NULL OR winner IN (0,1)), stats_json TEXT NOT NULL,
  story TEXT NOT NULL, trace_key TEXT, replay_unavailable INTEGER NOT NULL DEFAULT 0,
  crowd_json TEXT NOT NULL, opens_at INTEGER, starts_at INTEGER, ends_at INTEGER,
  next_at INTEGER, settled INTEGER NOT NULL DEFAULT 0, live_started INTEGER NOT NULL DEFAULT 0,
  owner_payout INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX fights_archive ON fights(settled, sequence DESC, id DESC);
CREATE TABLE league_state (
  id TEXT PRIMARY KEY CHECK (id = 'live'), revision INTEGER NOT NULL DEFAULT 0,
  generation INTEGER NOT NULL DEFAULT 1, phase TEXT NOT NULL DEFAULT 'preparing',
  current_id TEXT REFERENCES fights(id), pending_id TEXT REFERENCES fights(id),
  queue_json TEXT NOT NULL DEFAULT '[]', preparing INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, next_at INTEGER,
  maintenance INTEGER NOT NULL DEFAULT 1
);
INSERT INTO league_state(id) VALUES ('live');
CREATE TABLE wagers (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
  fight_id TEXT NOT NULL REFERENCES fights(id), side INTEGER NOT NULL CHECK (side IN (0,1)),
  stake INTEGER NOT NULL CHECK (stake > 0 AND stake % 100 = 0),
  payout INTEGER NOT NULL CHECK (payout >= 0 AND payout % 100 = 0),
  returned INTEGER, net INTEGER, UNIQUE(player_id, fight_id)
);
CREATE INDEX wagers_fight ON wagers(fight_id);
CREATE TABLE ledger (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id),
  fight_id TEXT REFERENCES fights(id), kind TEXT NOT NULL, amount INTEGER NOT NULL,
  balance INTEGER NOT NULL, note TEXT NOT NULL, effect_key TEXT UNIQUE, created_at INTEGER NOT NULL,
  CHECK (amount % 100 = 0 AND balance >= 0 AND balance % 100 = 0)
);
CREATE INDEX ledger_player ON ledger(player_id, created_at DESC, id DESC);
CREATE INDEX ledger_fight ON ledger(fight_id);
CREATE TABLE messages (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), name TEXT NOT NULL,
  ship TEXT, body TEXT NOT NULL, fight_id TEXT REFERENCES fights(id), created_at INTEGER NOT NULL
);
CREATE INDEX messages_recent ON messages(created_at DESC, id DESC);
CREATE TABLE mutes (
  player_id TEXT NOT NULL REFERENCES players(id), muted_id TEXT NOT NULL REFERENCES players(id),
  PRIMARY KEY(player_id, muted_id), CHECK (player_id <> muted_id)
);
CREATE TABLE reports (
  player_id TEXT NOT NULL REFERENCES players(id), message_id TEXT NOT NULL REFERENCES messages(id),
  PRIMARY KEY(player_id, message_id)
);
CREATE TABLE odds_cache (
  key TEXT PRIMARY KEY, probability REAL NOT NULL CHECK (probability >= 0 AND probability <= 1),
  samples INTEGER NOT NULL, simulator_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE commands (
  actor_id TEXT NOT NULL, command_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
  result_json TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(actor_id, command_id)
);
CREATE TABLE transitions (
  effect_key TEXT PRIMARY KEY, fight_id TEXT REFERENCES fights(id), revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE preparation_jobs (
  id TEXT PRIMARY KEY, generation INTEGER NOT NULL, ships_json TEXT NOT NULL,
  status TEXT NOT NULL, trace_key TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

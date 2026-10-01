-- Failed revision guards abort the entire D1 batch, including dependent effects.
CREATE TABLE commit_guard (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));
ALTER TABLE preparation_jobs ADD COLUMN input_json TEXT;
ALTER TABLE preparation_jobs ADD COLUMN sequence INTEGER;
ALTER TABLE preparation_jobs ADD COLUMN lease_until INTEGER;

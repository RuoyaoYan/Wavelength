CREATE TABLE IF NOT EXISTS achievements (
  id      TEXT PRIMARY KEY,
  game    TEXT NOT NULL,
  type    TEXT NOT NULL,
  at      INTEGER NOT NULL,
  score   INTEGER,
  lead    TEXT NOT NULL,
  others  TEXT NOT NULL,
  victims TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS achievements_at ON achievements (at DESC);

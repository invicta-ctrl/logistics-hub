CREATE TABLE IF NOT EXISTS staff_sessions (
 id TEXT PRIMARY KEY,
 expires_at INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_active ON staff_sessions(id, expires_at, revoked_at);

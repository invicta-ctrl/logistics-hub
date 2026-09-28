-- Access roles: STAFF (inventory), ADMIN (+ manage STAFF), OWNER (full, recovery).
-- SQLite cannot alter a CHECK constraint, so staff_accounts is rebuilt.
-- Dropping the old table deletes its referencing rows even under deferred foreign
-- keys, so sessions (short-lived by design) end here: everyone signs in again once.
PRAGMA defer_foreign_keys = true;
DELETE FROM staff_sessions;

CREATE TABLE staff_accounts_next (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN('STAFF','ADMIN','OWNER')),
 staff_user_id TEXT REFERENCES staff_users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 must_change_password INTEGER NOT NULL DEFAULT 0 CHECK(must_change_password IN(0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TEXT,
 updated_at TEXT
);
INSERT INTO staff_accounts_next(id, username, display_name, password_hash, role, staff_user_id, active, created_at, last_login_at)
 SELECT id, username, display_name, password_hash, role, staff_user_id, active, created_at, last_login_at FROM staff_accounts;
DROP TABLE staff_accounts;
ALTER TABLE staff_accounts_next RENAME TO staff_accounts;
CREATE INDEX IF NOT EXISTS idx_staff_accounts_role ON staff_accounts(role, active);
CREATE INDEX IF NOT EXISTS idx_staff_sessions_account ON staff_sessions(account_id, revoked_at);

-- Owner recovery: only a SHA-256 verifier of a 256-bit random secret is stored.
-- At most one live key per owner; a key is single-use and rotation revokes the old one.
CREATE TABLE IF NOT EXISTS owner_recovery_keys (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES staff_accounts(id),
 verifier TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_recovery_one_live ON owner_recovery_keys(account_id) WHERE revoked_at IS NULL;

-- Sign-in and recovery attempt counters shared by every Worker isolate.
CREATE TABLE IF NOT EXISTS auth_throttle (
 key TEXT PRIMARY KEY,
 count INTEGER NOT NULL,
 reset_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, created_at);

-- Login identity is separate from the staff directory: an account exists only
-- when an operator explicitly creates it (scripts/staff-account.mjs).
CREATE TABLE IF NOT EXISTS staff_accounts (
 id TEXT PRIMARY KEY,
 username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 display_name TEXT NOT NULL,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'STAFF' CHECK(role IN('STAFF')),
 staff_user_id TEXT REFERENCES staff_users(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 last_login_at TEXT
);

-- Development-only sessions from the retired env-var login have no account.
UPDATE staff_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL;
ALTER TABLE staff_sessions ADD COLUMN account_id TEXT REFERENCES staff_accounts(id);

-- Single counter bumped by every inventory write; clients poll it cheaply.
CREATE TABLE IF NOT EXISTS catalog_revision (id INTEGER PRIMARY KEY CHECK(id = 1), value INTEGER NOT NULL);
INSERT OR IGNORE INTO catalog_revision(id, value) VALUES(1, 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movements_idempotency ON inventory_movements(idempotency_key) WHERE idempotency_key IS NOT NULL;
ALTER TABLE items ADD COLUMN updated_at TEXT;

-- Quantity history is append-only; corrections are new movements.
CREATE TRIGGER IF NOT EXISTS inventory_movements_no_update BEFORE UPDATE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;
CREATE TRIGGER IF NOT EXISTS inventory_movements_no_delete BEFORE DELETE ON inventory_movements
BEGIN SELECT RAISE(ABORT, 'inventory_movements is append-only'); END;

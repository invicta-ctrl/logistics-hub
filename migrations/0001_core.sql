PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS items (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,aliases TEXT,category TEXT NOT NULL,stock_area TEXT,item_type TEXT NOT NULL,unit TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ACTIVE',catalog_type TEXT,storage_location TEXT,reorder_threshold INTEGER NOT NULL DEFAULT 0,
 lending_audience TEXT NOT NULL DEFAULT 'NOT_AVAILABLE_FOR_LENDING',default_loan_days INTEGER,maximum_loan_qty INTEGER,
 approval_required INTEGER NOT NULL DEFAULT 1 CHECK(approval_required IN(0,1)),needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN(0,1)),
 verification_note TEXT,notes TEXT,legacy_source_sheet TEXT,legacy_source_row TEXT,legacy_source_block TEXT,
 legacy_reported_opening_qty INTEGER NOT NULL DEFAULT 0,legacy_reported_reserved_qty INTEGER NOT NULL DEFAULT 0,legacy_reported_available_qty INTEGER,
 imported_from TEXT,imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id TEXT PRIMARY KEY,created_at TEXT NOT NULL,movement_type TEXT NOT NULL,direction TEXT NOT NULL CHECK(direction IN('IN','OUT','ADJUST')),
 item_id TEXT NOT NULL REFERENCES items(id),quantity INTEGER NOT NULL CHECK(quantity>=0),unit TEXT NOT NULL,signed_quantity INTEGER NOT NULL,
 related_entity_type TEXT,related_entity_id TEXT,actor_user_id TEXT,idempotency_key TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'POSTED',imported_from TEXT
);
CREATE INDEX IF NOT EXISTS idx_inventory_movements_item_created ON inventory_movements(item_id,created_at);
CREATE TABLE IF NOT EXISTS reservations (
 id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),quantity INTEGER NOT NULL CHECK(quantity>=0),unit TEXT NOT NULL,lending_ticket_id TEXT,
 status TEXT NOT NULL,created_at TEXT,updated_at TEXT,cleared_at TEXT,clear_reason TEXT,idempotency_key TEXT,imported_from TEXT
);
CREATE TABLE IF NOT EXISTS staff_users (
 id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'STAFF',department TEXT,committee TEXT,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),imported_from TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS loans (
 id TEXT PRIMARY KEY,borrower_classification TEXT NOT NULL CHECK(borrower_classification IN('STUDENT','USC_STAFF')),borrower_name TEXT NOT NULL,
 student_id_number TEXT NOT NULL,department TEXT NOT NULL,purpose TEXT,borrowed_at TEXT NOT NULL,due_at TEXT,returned_at TEXT,
 status TEXT NOT NULL CHECK(status IN('ON_LOAN','RETURNED','CANCELLED')),created_by TEXT,notes TEXT
);
CREATE TABLE IF NOT EXISTS loan_items (
 id TEXT PRIMARY KEY,loan_id TEXT NOT NULL REFERENCES loans(id),item_id TEXT NOT NULL REFERENCES items(id),quantity INTEGER NOT NULL CHECK(quantity>0),
 unit TEXT NOT NULL,return_condition TEXT,quantity_returned INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS evidence (
 id TEXT PRIMARY KEY,loan_id TEXT REFERENCES loans(id),item_id TEXT REFERENCES items(id),evidence_type TEXT NOT NULL,object_key TEXT NOT NULL,
 mime_type TEXT,size_bytes INTEGER,created_at TEXT NOT NULL,created_by TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
 id TEXT PRIMARY KEY,created_at TEXT NOT NULL,actor_user_id TEXT,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id TEXT,details_json TEXT
);
CREATE VIEW IF NOT EXISTS inventory_balances AS
SELECT i.id,i.name,i.unit,i.legacy_reported_opening_qty AS opening_qty,COALESCE(SUM(m.signed_quantity),0) AS movement_net,
 i.legacy_reported_opening_qty+COALESCE(SUM(m.signed_quantity),0) AS on_hand,i.legacy_reported_reserved_qty AS legacy_reserved_qty,
 (i.legacy_reported_opening_qty+COALESCE(SUM(m.signed_quantity),0))-i.legacy_reported_reserved_qty AS available,
 i.legacy_reported_available_qty,
 CASE WHEN i.legacy_reported_available_qty IS NULL THEN NULL
 ELSE (i.legacy_reported_opening_qty+COALESCE(SUM(m.signed_quantity),0))-i.legacy_reported_available_qty END AS migration_delta
FROM items i LEFT JOIN inventory_movements m ON m.item_id=i.id AND m.status='POSTED' GROUP BY i.id;

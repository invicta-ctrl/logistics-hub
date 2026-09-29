-- Part 3 — Stock + Pantry. Quantity stays movement-derived: nothing below stores stock.

-- Why a movement happened (validated by the Worker per movement kind). Adding a column
-- does not touch existing ledger rows; the append-only triggers still refuse UPDATE/DELETE.
ALTER TABLE inventory_movements ADD COLUMN reason TEXT;

-- Earliest known expiry on the shelf, for pantry items. Optional, item-level: the data
-- has no lots or batches, so this is deliberately not batch tracking.
ALTER TABLE items ADD COLUMN expires_on TEXT;

-- The restock list: a plan to replenish, never a quantity of stock. An entry is closed as
-- RESTOCKED only by the Stock in movement that received it, or DISMISSED by staff.
CREATE TABLE IF NOT EXISTS reorders (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES items(id),
 status TEXT NOT NULL CHECK(status IN ('NEEDS_RESTOCK','PLANNED','RESTOCKED','DISMISSED')),
 desired_quantity INTEGER CHECK(desired_quantity IS NULL OR desired_quantity > 0),
 note TEXT,
 movement_id TEXT REFERENCES inventory_movements(id),
 created_at TEXT NOT NULL,
 created_by TEXT,
 updated_at TEXT NOT NULL,
 updated_by TEXT,
 closed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reorders_one_open ON reorders(item_id) WHERE status IN ('NEEDS_RESTOCK','PLANNED');
CREATE INDEX IF NOT EXISTS idx_reorders_status ON reorders(status, updated_at);

-- Recent stock activity across all items.
CREATE INDEX IF NOT EXISTS idx_inventory_movements_created ON inventory_movements(created_at);

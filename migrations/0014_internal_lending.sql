-- Part 4: internal lending, and a catalog with two item types.

-- Earl, 2026-09-29: an item is either Loanable or Consumable. Every "Saleable" record is a
-- supply that leaves stock when sold or handed out, so it becomes Consumable. Each change is
-- written to the item's own history first, like any other catalog edit.
INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
  SELECT 'AUD-0014-' || id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'ITEM_UPDATED', 'ITEM', id, '{"itemType":{"from":"Saleable","to":"Consumable"}}'
  FROM items WHERE item_type = 'Saleable';
UPDATE items SET item_type = 'Consumable', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE item_type = 'Saleable';

-- The 0001 placeholders (loans, loan_items, evidence) were never used and hold no rows in any
-- environment. They are replaced by one loan record per item handed out.
DROP TABLE IF EXISTS loan_items;
DROP TABLE IF EXISTS evidence;
DROP TABLE IF EXISTS loans;

-- Each loan records the quantity lent and links to its LOAN_OUT movement. Only a good return
-- writes LOAN_RETURN, so on hand stays the sum of the ledger. Damaged or lost items do not come back.
-- The photo lives in R2 (binding EVIDENCE) under photo_key; D1 keeps only the key.
CREATE TABLE loans (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES items(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 purpose TEXT NOT NULL CHECK(purpose IN ('INDIVIDUAL', 'USC')),
 borrower_name TEXT NOT NULL,
 student_id TEXT,
 reason TEXT,
 photo_key TEXT NOT NULL,
 return_by TEXT,
 status TEXT NOT NULL DEFAULT 'OUT' CHECK(status IN ('OUT', 'RETURNED', 'DAMAGED', 'LOST')),
 movement_id TEXT NOT NULL UNIQUE REFERENCES inventory_movements(id),
 return_movement_id TEXT REFERENCES inventory_movements(id),
 return_note TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 closed_at TEXT,
 closed_by TEXT,
 CHECK(purpose = 'USC' OR student_id IS NOT NULL),
 CHECK(purpose = 'INDIVIDUAL' OR reason IS NOT NULL),
 CHECK((status = 'OUT') = (closed_at IS NULL))
);
CREATE INDEX idx_loans_status ON loans(status, created_at);
CREATE INDEX idx_loans_item ON loans(item_id, created_at);
CREATE INDEX idx_loans_created ON loans(created_at);

UPDATE catalog_revision SET value = value + 1 WHERE id = 1;

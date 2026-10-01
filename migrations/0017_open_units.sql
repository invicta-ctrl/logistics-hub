-- Part 5B: open-unit tracking (amendment A12). Additive for items and stock: no quantity, movement or
-- classification changes. Every existing item stays WHOLE_UNIT until staff opt it in.
--
-- How a Consumable is used. OPEN_UNIT: counted by its outer unit (a ream, a bottle) but used a
-- little at a time; staff track which units are open. Ignored for anything that is not a Consumable.
ALTER TABLE items ADD COLUMN consumption_mode TEXT NOT NULL DEFAULT 'WHOLE_UNIT' CHECK(consumption_mode IN ('WHOLE_UNIT', 'OPEN_UNIT'));

-- One opened outer unit. Never a quantity: on-hand stays the movement ledger's, and sealed is derived
-- (on_hand - open units). A unit is closed once, never reopened or deleted: EMPTY with the guarded -1
-- movement that used it up, CORRECTED when it was never really open (no movement), COUNTED when a
-- physical count found it gone (the count's movement). The optional condition is a label, not an amount.
CREATE TABLE open_units (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES items(id),
 idempotency_key TEXT NOT NULL UNIQUE,
 opened_at TEXT NOT NULL,
 opened_by TEXT NOT NULL,
 condition TEXT CHECK(condition IS NULL OR condition IN ('PLENTY', 'HALF', 'LOW')),
 condition_at TEXT,
 condition_by TEXT,
 closed_at TEXT,
 closed_by TEXT,
 close_kind TEXT CHECK(close_kind IS NULL OR close_kind IN ('EMPTY', 'CORRECTED', 'COUNTED')),
 movement_id TEXT,
 CHECK((closed_at IS NULL) = (close_kind IS NULL)),
 CHECK(close_kind IS NULL OR close_kind = 'CORRECTED' OR movement_id IS NOT NULL)
);
CREATE INDEX idx_open_units_open ON open_units(item_id) WHERE closed_at IS NULL;

CREATE TRIGGER open_units_closed_final BEFORE UPDATE ON open_units
WHEN OLD.closed_at IS NOT NULL
BEGIN
 SELECT RAISE(ABORT, 'open_unit_closed');
END;
CREATE TRIGGER open_units_kept BEFORE DELETE ON open_units
BEGIN
 SELECT RAISE(ABORT, 'open_unit_kept');
END;

-- The invariant, enforced by the database for every writer: open units never exceed on-hand. A
-- statement that would break it (opening one too many, or taking stock below the open units) is
-- rolled back with its whole batch. Only items with an open unit pay for the check.
CREATE TRIGGER open_units_within_stock AFTER INSERT ON open_units
WHEN (SELECT COUNT(*) FROM open_units WHERE item_id = NEW.item_id AND closed_at IS NULL) > (SELECT on_hand FROM inventory_balances WHERE id = NEW.item_id)
BEGIN
 SELECT RAISE(ABORT, 'open_units_exceed_on_hand');
END;
CREATE TRIGGER movements_within_open_units AFTER INSERT ON inventory_movements
WHEN NEW.status = 'POSTED' AND NEW.signed_quantity < 0 AND EXISTS (SELECT 1 FROM open_units WHERE item_id = NEW.item_id AND closed_at IS NULL)
 AND (SELECT COUNT(*) FROM open_units WHERE item_id = NEW.item_id AND closed_at IS NULL) > (SELECT on_hand FROM inventory_balances WHERE id = NEW.item_id)
BEGIN
 SELECT RAISE(ABORT, 'open_units_exceed_on_hand');
END;
-- An item with an open unit stays an active open-unit Consumable until its open units are closed.
CREATE TRIGGER items_keep_open_units BEFORE UPDATE OF consumption_mode, item_type, status ON items
WHEN (NEW.consumption_mode <> 'OPEN_UNIT' OR NEW.item_type <> 'Consumable' OR NEW.status = 'INACTIVE')
 AND EXISTS (SELECT 1 FROM open_units WHERE item_id = NEW.id AND closed_at IS NULL)
BEGIN
 SELECT RAISE(ABORT, 'open_units_block_change');
END;

-- Phone Use (an open-unit Consumable, stock change 0) is a fourth self-service event type. SQLite
-- cannot alter a CHECK constraint, so the table is rebuilt with every row, index and trigger as before.
CREATE TABLE self_service_events_next (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL,
 seq INTEGER NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('TAKE', 'BORROW', 'RETURN', 'USE')),
 item_id TEXT NOT NULL REFERENCES items(id),
 quantity INTEGER NOT NULL CHECK(quantity > 0),
 person_name TEXT NOT NULL,
 student_id TEXT,
 purpose TEXT CHECK(purpose IS NULL OR purpose IN ('INDIVIDUAL', 'USC')),
 reason TEXT,
 return_outcome TEXT CHECK(return_outcome IS NULL OR return_outcome IN ('RETURNED', 'DAMAGED', 'LOST')),
 note TEXT,
 return_by TEXT,
 loan_event_id TEXT,
 photo_key TEXT,
 device_time TEXT NOT NULL,
 sent_at TEXT NOT NULL,
 occurred_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 client_tag TEXT,
 catalog_revision INTEGER,
 loan_id TEXT,
 movement_id TEXT,
 applied INTEGER NOT NULL CHECK(applied IN (0, 1)),
 review TEXT,
 resolved_at TEXT,
 resolved_by TEXT,
 resolution_note TEXT,
 CHECK((resolved_at IS NULL) OR (review IS NOT NULL))
);
INSERT INTO self_service_events_next SELECT id, device_id, seq, event_type, item_id, quantity, person_name, student_id, purpose, reason,
 return_outcome, note, return_by, loan_event_id, photo_key, device_time, sent_at, occurred_at, received_at, client_tag, catalog_revision,
 loan_id, movement_id, applied, review, resolved_at, resolved_by, resolution_note FROM self_service_events;
DROP TABLE self_service_events;
ALTER TABLE self_service_events_next RENAME TO self_service_events;
CREATE INDEX idx_self_service_events_received ON self_service_events(received_at);
CREATE INDEX idx_self_service_events_open ON self_service_events(received_at) WHERE review IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX idx_self_service_events_loan ON self_service_events(loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX idx_self_service_events_item ON self_service_events(item_id, received_at);
-- 0016's Activity indexes, the phone one now also covering Use (it changes no stock, so no movement repeats it).
CREATE INDEX idx_activity_phone ON self_service_events((COALESCE(CASE WHEN occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) END, '0000-01-01T00:00:00.000Z')), id)
  WHERE (review IS NOT NULL OR event_type IN ('RETURN', 'USE') OR applied = 0);
CREATE INDEX idx_activity_resolved ON self_service_events((COALESCE(CASE WHEN resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', resolved_at) END, '0000-01-01T00:00:00.000Z')), id)
  WHERE resolved_at IS NOT NULL;
CREATE TRIGGER self_service_events_resolved_final BEFORE UPDATE ON self_service_events
WHEN OLD.resolved_at IS NOT NULL
BEGIN
 SELECT RAISE(ABORT, 'self_service_event_resolved');
END;

UPDATE catalog_revision SET value = value + 1 WHERE id = 1;

-- Part 4.5: phone self-service (Borrow, Take, Return) that keeps working offline.
-- Additive only: code already live ignores the new column and the new table.

-- Which items people may take or borrow with their own phone. Fail closed: nothing is
-- self-service until staff turn it on for that item.
ALTER TABLE items ADD COLUMN self_service INTEGER NOT NULL DEFAULT 0 CHECK(self_service IN (0, 1));

-- Every action a phone synced, stored once under the phone's own event id. It is the
-- idempotency record and the staff review queue. What an event changed lives in the
-- canonical tables: a Take is an inventory movement, a Borrow a loan, a Return closes one.
-- An event is applied (applied = 1) or held for a staff decision (applied = 0, review set).
-- occurred_at is business time: the device clock corrected by (received_at - sent_at), both
-- measured on the same phone. client_tag is a keyed hash of the network, never the address.
-- photo_key keeps a held borrow's photo so staff can still apply it.
CREATE TABLE self_service_events (
 id TEXT PRIMARY KEY,
 device_id TEXT NOT NULL,
 seq INTEGER NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('TAKE', 'BORROW', 'RETURN')),
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
CREATE INDEX idx_self_service_events_received ON self_service_events(received_at);
CREATE INDEX idx_self_service_events_open ON self_service_events(received_at) WHERE review IS NOT NULL AND resolved_at IS NULL;
CREATE INDEX idx_self_service_events_loan ON self_service_events(loan_id) WHERE loan_id IS NOT NULL;
CREATE INDEX idx_self_service_events_item ON self_service_events(item_id, received_at);
-- A staff resolution is final: of two staff acting on one record at once, the second is rolled back.
CREATE TRIGGER self_service_events_resolved_final BEFORE UPDATE ON self_service_events
WHEN OLD.resolved_at IS NOT NULL
BEGIN
 SELECT RAISE(ABORT, 'self_service_event_resolved');
END;

UPDATE catalog_revision SET value = value + 1 WHERE id = 1;

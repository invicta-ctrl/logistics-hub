-- V1.5: Rapid Catalogue. Additive only: the code live before this change ignores everything below.
-- No quantity, movement or classification of any existing item changes.

-- Optional per-item identity, used by cataloguing and as duplicate signals. Quantity-based parent records stay the norm:
-- nothing here makes an ordinary consumable an individually tracked asset.
ALTER TABLE items ADD COLUMN model TEXT CHECK(model IS NULL OR length(model) BETWEEN 1 AND 80);
ALTER TABLE items ADD COLUMN serial_number TEXT CHECK(serial_number IS NULL OR length(serial_number) BETWEEN 1 AND 80);
CREATE INDEX idx_items_serial ON items(serial_number) WHERE serial_number IS NOT NULL;

-- A 64-bit difference hash of an item's photo (16 hex digits, made in the browser), so a picture of an item already in the
-- catalog is noticed. It is only ever a hint shown to staff; nothing is merged or refused because of it.
ALTER TABLE item_media ADD COLUMN dhash TEXT CHECK(dhash IS NULL OR (length(dhash) = 16 AND dhash NOT GLOB '*[^0-9a-f]*'));

-- A cataloguing session: one staff member walking a shelf. Server-side, so it resumes on any device that member signs in on.
-- `location_id` is where the next item is assumed to be (the sticky place); every capture also records its own place.
CREATE TABLE catalogue_sessions (
 id TEXT PRIMARY KEY CHECK(id GLOB 'CS-*' AND length(id) = 39),
 started_by TEXT NOT NULL REFERENCES staff_accounts(id),
 location_id TEXT REFERENCES locations(id),
 status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','FINISHED')),
 started_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 finished_at TEXT,
 CHECK((status = 'FINISHED') = (finished_at IS NOT NULL))
);
-- One open session per person: starting again resumes it.
CREATE UNIQUE INDEX idx_catalogue_one_active ON catalogue_sessions(started_by) WHERE status = 'ACTIVE';

-- One row per item catalogued in a session. `id` is the request id the browser made, so a retried save (a dropped connection
-- that lost the answer) finds its own row instead of making a second item. What staff chose is kept here as they chose it;
-- `acknowledged` lists the possible matches they saw and still saved as a separate item.
CREATE TABLE catalogue_captures (
 id TEXT PRIMARY KEY CHECK(length(id) = 36),
 session_id TEXT NOT NULL REFERENCES catalogue_sessions(id),
 item_id TEXT NOT NULL UNIQUE REFERENCES items(id),
 location_id TEXT REFERENCES locations(id),
 behaviour TEXT NOT NULL CHECK(behaviour IN('BORROW','CONSUME','GRADUAL','REVIEW_LATER')),
 acknowledged TEXT CHECK(acknowledged IS NULL OR json_valid(acknowledged)),
 created_at TEXT NOT NULL
);
CREATE INDEX idx_catalogue_captures_session ON catalogue_captures(session_id, created_at);

-- The database keeps the record honest for every writer.
CREATE TRIGGER catalogue_captures_session_active BEFORE INSERT ON catalogue_captures
WHEN NOT EXISTS (SELECT 1 FROM catalogue_sessions WHERE id = NEW.session_id AND status = 'ACTIVE')
BEGIN SELECT RAISE(ABORT, 'catalogue_session_finished'); END;
CREATE TRIGGER catalogue_captures_append_only_update BEFORE UPDATE ON catalogue_captures
BEGIN SELECT RAISE(ABORT, 'catalogue_capture_final'); END;
CREATE TRIGGER catalogue_captures_append_only_delete BEFORE DELETE ON catalogue_captures
BEGIN SELECT RAISE(ABORT, 'catalogue_capture_final'); END;
CREATE TRIGGER catalogue_sessions_finished_final BEFORE UPDATE ON catalogue_sessions
WHEN OLD.status = 'FINISHED'
BEGIN SELECT RAISE(ABORT, 'catalogue_session_finished'); END;
CREATE TRIGGER catalogue_sessions_kept BEFORE DELETE ON catalogue_sessions
BEGIN SELECT RAISE(ABORT, 'catalogue_session_kept'); END;

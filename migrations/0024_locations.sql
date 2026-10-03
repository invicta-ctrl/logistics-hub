-- V1.4: reusable, hierarchical locations (Office > Storage Area > Cabinet 1 > Shelf 2) instead of repeated free text.
-- Additive only: the code live before this change keeps reading items.storage_location, which is never rewritten or
-- cleared here (or by the new code): it stays as the originally recorded value, the migration's evidence.

CREATE TABLE locations (
 id TEXT PRIMARY KEY CHECK(id GLOB 'LOC-[0-9][0-9][0-9][0-9]*'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120 AND name = trim(name)),
 parent_id TEXT REFERENCES locations(id) CHECK(parent_id IS NULL OR parent_id <> id),
 directions TEXT CHECK(directions IS NULL OR length(directions) BETWEEN 1 AND 600),
 -- Whether Self-Service shows this place's directions and picture. Staff-only is the default for anything new.
 visibility TEXT NOT NULL DEFAULT 'STAFF_ONLY' CHECK(visibility IN('STAFF_ONLY','SELF_SERVICE')),
 -- The one reference picture (R2 CATALOG_MEDIA: locations/<media_id>/display and /thumb); many items share it through their location.
 media_id TEXT UNIQUE CHECK(media_id IS NULL OR length(media_id) = 36),
 media_width INTEGER CHECK(media_width IS NULL OR media_width BETWEEN 1 AND 1600),
 media_height INTEGER CHECK(media_height IS NULL OR media_height BETWEEN 1 AND 1600),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 imported_from TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id),
 updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES staff_accounts(id),
 CHECK((media_id IS NULL) = (media_width IS NULL) AND (media_id IS NULL) = (media_height IS NULL))
);
-- Exact (case-sensitive) so reconciliation can keep "Cabinet 1" and "cabinet 1" apart; the Worker refuses new near-duplicates.
CREATE UNIQUE INDEX idx_locations_sibling_name ON locations(COALESCE(parent_id, ''), name);
CREATE INDEX idx_locations_parent ON locations(parent_id);

ALTER TABLE items ADD COLUMN location_id TEXT REFERENCES locations(id);
CREATE INDEX idx_items_location ON items(location_id);

-- Every place with its full path, depth and whether Self-Service may show it: it, and every place above it, is active and shared.
CREATE VIEW location_paths AS
WITH RECURSIVE walk(id, path, depth, shown) AS (
 SELECT id, name, 1, active = 1 AND visibility = 'SELF_SERVICE' FROM locations WHERE parent_id IS NULL
 UNION ALL
 SELECT l.id, w.path || ' › ' || l.name, w.depth + 1, w.shown AND l.active = 1 AND l.visibility = 'SELF_SERVICE'
 FROM locations l JOIN walk w ON l.parent_id = w.id WHERE w.depth < 8
)
SELECT id, path, depth, shown FROM walk;

-- The database keeps the hierarchy sound for every writer: no loops, no active place under an inactive one, no item in an inactive place.
CREATE TRIGGER locations_no_cycle BEFORE UPDATE OF parent_id ON locations
WHEN NEW.parent_id IS NOT NULL AND EXISTS (
 WITH RECURSIVE up(id) AS (SELECT NEW.parent_id UNION ALL SELECT l.parent_id FROM locations l JOIN up ON l.id = up.id WHERE l.parent_id IS NOT NULL)
 SELECT 1 FROM up WHERE id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'location_cycle'); END;
CREATE TRIGGER locations_parent_active_insert BEFORE INSERT ON locations
WHEN NEW.active = 1 AND NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.parent_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_parent_inactive'); END;
CREATE TRIGGER locations_parent_active_update BEFORE UPDATE OF parent_id, active ON locations
WHEN NEW.active = 1 AND NEW.parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.parent_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_parent_inactive'); END;
CREATE TRIGGER locations_children_active BEFORE UPDATE OF active ON locations
WHEN OLD.active = 1 AND NEW.active = 0 AND EXISTS (SELECT 1 FROM locations WHERE parent_id = OLD.id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_has_active_children'); END;
CREATE TRIGGER items_location_active_insert BEFORE INSERT ON items
WHEN NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_inactive'); END;
CREATE TRIGGER items_location_active_update BEFORE UPDATE OF location_id ON items
WHEN NEW.location_id IS NOT NULL AND NEW.location_id IS NOT OLD.location_id AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_inactive'); END;

-- "I can't find it" and "Location looks wrong": attention signals that never change stock or an item's location by themselves.
CREATE TABLE location_reports (
 id TEXT PRIMARY KEY CHECK(length(id) = 36),
 item_id TEXT NOT NULL REFERENCES items(id),
 -- Where the item was said to be when it was reported (kept even if the item is later moved).
 location_id TEXT REFERENCES locations(id),
 kind TEXT NOT NULL CHECK(kind IN('CANT_FIND','LOCATION_WRONG')),
 source TEXT NOT NULL CHECK(source IN('STAFF','SELF_SERVICE')),
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 300),
 reported_by TEXT REFERENCES staff_accounts(id),
 -- A keyed hash of the sender's network, as on Self-Service records: it shows reports came from one place, never who.
 client_tag TEXT,
 created_at TEXT NOT NULL,
 resolved_at TEXT,
 resolved_by TEXT REFERENCES staff_accounts(id),
 resolution_note TEXT CHECK(resolution_note IS NULL OR length(resolution_note) BETWEEN 1 AND 300),
 CHECK((source = 'STAFF') = (reported_by IS NOT NULL)),
 CHECK((resolved_at IS NULL) = (resolved_by IS NULL))
);
CREATE INDEX idx_location_reports_open ON location_reports(item_id) WHERE resolved_at IS NULL;
CREATE INDEX idx_location_reports_item ON location_reports(item_id, created_at);
-- A report is a record: it is resolved once, with a note, and never edited or removed.
CREATE TRIGGER location_reports_no_delete BEFORE DELETE ON location_reports
BEGIN SELECT RAISE(ABORT, 'location_reports are append-only'); END;
CREATE TRIGGER location_reports_resolve_only BEFORE UPDATE ON location_reports
WHEN OLD.resolved_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.item_id IS NOT OLD.item_id OR NEW.location_id IS NOT OLD.location_id OR NEW.kind IS NOT OLD.kind
 OR NEW.source IS NOT OLD.source OR NEW.note IS NOT OLD.note OR NEW.reported_by IS NOT OLD.reported_by OR NEW.client_tag IS NOT OLD.client_tag OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'location_report_final'); END;

-- Reconciliation of what is already recorded. One place per distinct stored value (trimmed, otherwise exactly as typed), none
-- merged: "Cabinet 1" and "cabinet 1" become two places for staff to combine deliberately (Locations -> Move items). Items are
-- linked by that exact value. A place starts shared with Self-Service only if an item in it is offered there today, which is the
-- only way its text was public before; everything else starts staff-only.
INSERT INTO locations(id, name, visibility, active, imported_from, created_at, updated_at)
SELECT 'LOC-' || printf('%04d', ROW_NUMBER() OVER (ORDER BY name COLLATE NOCASE, name)), name,
 CASE WHEN offered = 1 THEN 'SELF_SERVICE' ELSE 'STAFF_ONLY' END, 1, 'ITEM_STORAGE_LOCATION',
 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
 SELECT trim(storage_location) AS name,
  MAX(status = 'ACTIVE' AND needs_review = 0 AND (
   (item_type = 'Loanable' AND lending_audience IN ('STUDENTS_AND_USC_STAFF', 'USC_STAFF_ONLY')) OR item_type = 'Consumable')) AS offered
 FROM items WHERE storage_location IS NOT NULL AND trim(storage_location) <> '' GROUP BY trim(storage_location)
);
UPDATE items SET location_id = (SELECT l.id FROM locations l WHERE l.parent_id IS NULL AND l.name = trim(items.storage_location))
WHERE storage_location IS NOT NULL AND trim(storage_location) <> '';

-- The evidence, kept with the data: what was found, what was created, and every spelling group staff should look at.
INSERT INTO audit_log(id, created_at, actor_user_id, action, entity_type, entity_id, details_json)
SELECT 'MIGRATION-0024-LOCATIONS', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), NULL, 'LOCATIONS_RECONCILED', 'LOCATION', '0024',
 json_object(
  'itemsWithStorageLocation', (SELECT COUNT(*) FROM items WHERE storage_location IS NOT NULL AND trim(storage_location) <> ''),
  'itemsLinked', (SELECT COUNT(*) FROM items WHERE location_id IS NOT NULL),
  'locationsCreated', (SELECT COUNT(*) FROM locations),
  'sharedWithSelfService', (SELECT COUNT(*) FROM locations WHERE visibility = 'SELF_SERVICE'),
  'sameNameDifferentCase', (SELECT COUNT(*) FROM (SELECT lower(name) FROM locations GROUP BY lower(name) HAVING COUNT(*) > 1)));

UPDATE catalog_revision SET value = value + 1 WHERE id = 1;

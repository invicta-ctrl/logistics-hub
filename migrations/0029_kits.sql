-- V1.8: Kits and Kit Templates. Additive only: the code live before this change ignores everything below.
-- A kit is a list of existing items with the quantity each should have. It holds no stock of its own: how many of an item are there
-- is still the item's own ledger balance, and a kit's readiness is derived from that at read time. Nothing here writes a movement,
-- changes an item, a place or a loan. A check of a kit records what staff saw; stock changes only through the existing movement rules.

-- A template: a repeatable list of components (Sewing Kit, Arts & Crafts Kit). Making a kit from it copies the list; the kit does not
-- follow later template edits, and the template carries no stock.
CREATE TABLE kit_templates (
 id TEXT PRIMARY KEY CHECK(id GLOB 'KTP-[0-9][0-9][0-9][0-9]*'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 description TEXT CHECK(description IS NULL OR length(description) BETWEEN 1 AND 600),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id),
 updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES staff_accounts(id)
);
CREATE UNIQUE INDEX idx_kit_templates_name ON kit_templates(lower(name));

CREATE TABLE kit_template_components (
 template_id TEXT NOT NULL REFERENCES kit_templates(id),
 item_id TEXT NOT NULL REFERENCES items(id),
 required INTEGER NOT NULL CHECK(required BETWEEN 1 AND 1000),
 position INTEGER NOT NULL CHECK(position >= 0),
 PRIMARY KEY(template_id, item_id)
);

-- A physical kit: a name staff say aloud, where it is kept, and (optionally) the template it was made from.
CREATE TABLE kits (
 id TEXT PRIMARY KEY CHECK(id GLOB 'KIT-[0-9][0-9][0-9][0-9]*'),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 description TEXT CHECK(description IS NULL OR length(description) BETWEEN 1 AND 600),
 location_id TEXT REFERENCES locations(id),
 template_id TEXT REFERENCES kit_templates(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
 -- The one optional picture (CATALOG_MEDIA: kits/<media_id>/display and /thumb), the place pictures' way.
 media_id TEXT UNIQUE CHECK(media_id IS NULL OR length(media_id) = 36),
 media_width INTEGER CHECK(media_width IS NULL OR media_width BETWEEN 1 AND 1600),
 media_height INTEGER CHECK(media_height IS NULL OR media_height BETWEEN 1 AND 1600),
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id),
 updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES staff_accounts(id),
 CHECK((media_id IS NULL) = (media_width IS NULL) AND (media_id IS NULL) = (media_height IS NULL))
);
CREATE UNIQUE INDEX idx_kits_name ON kits(lower(name));
CREATE INDEX idx_kits_location ON kits(location_id) WHERE location_id IS NOT NULL;

-- What a kit should hold: an item and how many. The item keeps its own behaviour (borrow & return, take, use gradually), so one kit
-- can mix all three. An item appears once in a kit.
CREATE TABLE kit_components (
 kit_id TEXT NOT NULL REFERENCES kits(id),
 item_id TEXT NOT NULL REFERENCES items(id),
 required INTEGER NOT NULL CHECK(required BETWEEN 1 AND 1000),
 position INTEGER NOT NULL CHECK(position >= 0),
 PRIMARY KEY(kit_id, item_id)
);
CREATE INDEX idx_kit_components_item ON kit_components(item_id);

-- A check of a kit: one staff member going through its components. The record of what they saw, kept as seen.
CREATE TABLE kit_checks (
 id TEXT PRIMARY KEY CHECK(id GLOB 'KC-*' AND length(id) = 39),
 kit_id TEXT NOT NULL REFERENCES kits(id),
 checked_by TEXT NOT NULL REFERENCES staff_accounts(id),
 checked_at TEXT NOT NULL,
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 300),
 ok_count INTEGER NOT NULL CHECK(ok_count >= 0),
 flagged_count INTEGER NOT NULL CHECK(flagged_count >= 0),
 -- Components of the kit when it was checked that were not marked: they stay "not checked" in the summary.
 unchecked_count INTEGER NOT NULL CHECK(unchecked_count >= 0)
);
CREATE INDEX idx_kit_checks_kit ON kit_checks(kit_id, checked_at);

CREATE TABLE kit_check_observations (
 check_id TEXT NOT NULL REFERENCES kit_checks(id),
 item_id TEXT NOT NULL REFERENCES items(id),
 outcome TEXT NOT NULL CHECK(outcome IN('OK','LOW','MISSING','DAMAGED')),
 -- What the kit asked for and what the ledger said when it was seen, so a later reader sees what the observer was comparing against.
 required INTEGER NOT NULL CHECK(required >= 1),
 on_hand INTEGER NOT NULL,
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 300),
 PRIMARY KEY(check_id, item_id)
);
CREATE INDEX idx_kit_check_observations_item ON kit_check_observations(item_id);

-- The database keeps the record honest for every writer.
CREATE TRIGGER kit_checks_no_update BEFORE UPDATE ON kit_checks
BEGIN SELECT RAISE(ABORT, 'kit_check_final'); END;
CREATE TRIGGER kit_checks_no_delete BEFORE DELETE ON kit_checks
BEGIN SELECT RAISE(ABORT, 'kit_check_final'); END;
CREATE TRIGGER kit_check_observations_no_update BEFORE UPDATE ON kit_check_observations
BEGIN SELECT RAISE(ABORT, 'kit_check_final'); END;
CREATE TRIGGER kit_check_observations_no_delete BEFORE DELETE ON kit_check_observations
BEGIN SELECT RAISE(ABORT, 'kit_check_final'); END;
CREATE TRIGGER kits_kept BEFORE DELETE ON kits
BEGIN SELECT RAISE(ABORT, 'kit_kept'); END;
CREATE TRIGGER kit_templates_kept BEFORE DELETE ON kit_templates
BEGIN SELECT RAISE(ABORT, 'kit_template_kept'); END;
-- A kit is never kept in an inactive place; an item in a kit stays a real record.
CREATE TRIGGER kits_place_active BEFORE INSERT ON kits
WHEN NEW.location_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_inactive'); END;
CREATE TRIGGER kits_place_active_update BEFORE UPDATE OF location_id ON kits
WHEN NEW.location_id IS NOT NULL AND NEW.location_id IS NOT OLD.location_id AND NOT EXISTS (SELECT 1 FROM locations WHERE id = NEW.location_id AND active = 1)
BEGIN SELECT RAISE(ABORT, 'location_inactive'); END;

-- V1.7: Physical inventory by location. Additive only: the code live before this change ignores everything below.
-- No quantity, movement, place or classification changes here. An audit records what staff saw; stock changes only through the
-- existing count movement (COUNT_ADJUSTMENT), posted deliberately at the review, never by an observation.

-- An audit: one staff member checking what should be at one place (and the places inside it). Durable id and timestamps; it pauses
-- and resumes on any device that member signs in on (or on the device's offline access, V1.6).
CREATE TABLE location_audits (
 id TEXT PRIMARY KEY CHECK(id GLOB 'LA-*' AND length(id) = 39),
 location_id TEXT NOT NULL REFERENCES locations(id),
 started_by TEXT NOT NULL REFERENCES staff_accounts(id),
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','PAUSED','FINISHED')),
 -- How many items were expected there when it started: progress reads "31 / 38 checked" against the live list, this is the record.
 expected_at_start INTEGER NOT NULL CHECK(expected_at_start >= 0),
 -- Staff's note that the place's directions or picture need correcting, seen during the audit.
 place_note TEXT CHECK(place_note IS NULL OR length(place_note) BETWEEN 1 AND 300),
 started_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 finished_at TEXT,
 finished_by TEXT REFERENCES staff_accounts(id),
 CHECK((status = 'FINISHED') = (finished_at IS NOT NULL)),
 CHECK((finished_at IS NULL) = (finished_by IS NULL))
);
-- One audit open (or paused) per place at a time, so two people never check the same shelf against each other unknowingly.
CREATE UNIQUE INDEX idx_location_audits_one_open ON location_audits(location_id) WHERE status <> 'FINISHED';
CREATE INDEX idx_location_audits_person ON location_audits(started_by, status);

-- What staff saw for one item. Append-only: a second look at the same item is a new row, and the latest one counts. `id` is the request
-- id the device made, so a resent observation (an answer lost offline) is found, not repeated.
-- `expected_on_hand` is the figure the device showed when it was recorded; `on_hand_at_receipt` is the server's when it arrived. When
-- they differ, stock changed meanwhile (another device, a loan, a delivery) and the review asks for a recount instead of posting.
CREATE TABLE location_audit_observations (
 id TEXT PRIMARY KEY CHECK(length(id) = 36),
 audit_id TEXT NOT NULL REFERENCES location_audits(id),
 item_id TEXT REFERENCES items(id),
 outcome TEXT NOT NULL CHECK(outcome IN('CONFIRMED','MISMATCH','CANT_FIND','FOUND_HERE','UNLISTED','NEEDS_REVIEW')),
 expected_on_hand INTEGER,
 counted INTEGER CHECK(counted IS NULL OR counted BETWEEN 0 AND 100000),
 on_hand_at_receipt INTEGER,
 -- Where the record said the item was kept when it was seen (FOUND_HERE: somewhere else), and, for something found that was not on the
 -- list, where in the checked place it was seen.
 recorded_location_id TEXT REFERENCES locations(id),
 seen_location_id TEXT REFERENCES locations(id),
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 300),
 observed_by TEXT NOT NULL REFERENCES staff_accounts(id),
 observed_at TEXT NOT NULL,
 received_at TEXT NOT NULL,
 CHECK((outcome = 'UNLISTED') = (item_id IS NULL)),
 CHECK((outcome IN('FOUND_HERE','UNLISTED')) = (seen_location_id IS NOT NULL)),
 CHECK(outcome <> 'UNLISTED' OR note IS NOT NULL),
 CHECK((outcome IN('CONFIRMED','MISMATCH','FOUND_HERE')) = (counted IS NOT NULL)),
 CHECK(outcome <> 'MISMATCH' OR counted IS NOT expected_on_hand)
);
CREATE INDEX idx_audit_observations_audit ON location_audit_observations(audit_id, received_at);
CREATE INDEX idx_audit_observations_item ON location_audit_observations(item_id, received_at) WHERE item_id IS NOT NULL;

-- How a discrepancy was settled at the review. Append-only, one per observation: the observation stays as seen, this says what was done.
-- POSTED_COUNT names the count movement it wrote (through the ledger's own guard); MOVED_HERE changed the item's place (audited as an
-- item edit); REPORTED filed a location report (whose id is the observation's); NO_CHANGE keeps the record as it is, with the reason.
-- A discrepancy with no resolution stays visible as unresolved until one is made, or a later count or confirmation supersedes it.
CREATE TABLE location_audit_resolutions (
 observation_id TEXT PRIMARY KEY REFERENCES location_audit_observations(id),
 action TEXT NOT NULL CHECK(action IN('POSTED_COUNT','MOVED_HERE','REPORTED','NO_CHANGE')),
 movement_id TEXT REFERENCES inventory_movements(id),
 report_id TEXT REFERENCES location_reports(id),
 note TEXT CHECK(note IS NULL OR length(note) BETWEEN 1 AND 300),
 resolved_by TEXT NOT NULL REFERENCES staff_accounts(id),
 resolved_at TEXT NOT NULL,
 CHECK((action = 'POSTED_COUNT') = (movement_id IS NOT NULL)),
 CHECK((action = 'REPORTED') = (report_id IS NOT NULL)),
 CHECK(action <> 'NO_CHANGE' OR note IS NOT NULL)
);

-- The database keeps the record honest for every writer.
CREATE TRIGGER location_audit_observations_open BEFORE INSERT ON location_audit_observations
WHEN NOT EXISTS (SELECT 1 FROM location_audits WHERE id = NEW.audit_id AND status <> 'FINISHED')
BEGIN SELECT RAISE(ABORT, 'location_audit_finished'); END;
CREATE TRIGGER location_audit_observations_no_update BEFORE UPDATE ON location_audit_observations
BEGIN SELECT RAISE(ABORT, 'location_audit_observation_final'); END;
CREATE TRIGGER location_audit_observations_no_delete BEFORE DELETE ON location_audit_observations
BEGIN SELECT RAISE(ABORT, 'location_audit_observation_final'); END;
CREATE TRIGGER location_audit_resolutions_no_update BEFORE UPDATE ON location_audit_resolutions
BEGIN SELECT RAISE(ABORT, 'location_audit_resolution_final'); END;
CREATE TRIGGER location_audit_resolutions_no_delete BEFORE DELETE ON location_audit_resolutions
BEGIN SELECT RAISE(ABORT, 'location_audit_resolution_final'); END;
CREATE TRIGGER location_audits_finished_final BEFORE UPDATE ON location_audits
WHEN OLD.status = 'FINISHED'
BEGIN SELECT RAISE(ABORT, 'location_audit_finished'); END;
CREATE TRIGGER location_audits_kept BEFORE DELETE ON location_audits
BEGIN SELECT RAISE(ABORT, 'location_audit_kept'); END;

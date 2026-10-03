-- V1.3: the private USC Staff Directory. Additive only: the code live before this change ignores both tables.
--
-- staff_directory: one row per person, organised by department (codes and names in src/directory-policy.ts).
--   officer is a status beside the department, never a department: an officer filed under OFFICERS keeps the
--   department encoded in the file name. account_id is the explicit, audited link to a sign-in (one each way);
--   it is never inferred. student_id, when an administrator enters it, matches the person's own loans and phone
--   records by that number. source_key is the import's identity (normalised name + department code), so
--   importing the same archive again finds the same person instead of adding another.
-- staff_id_cards: the official USC ID scans of a person. The images live only in the STAFF_IDS R2 bucket
--   (ids/<media_id>/front and ids/<media_id>/back), never in the catalog or evidence buckets; this row is the only
--   reference to them, and a replacement gets a new media_id so a stored scan is never overwritten in place.
--
-- The 0001 staff_users table (empty in every environment) is not used by the directory.
CREATE TABLE staff_directory (
 id TEXT PRIMARY KEY CHECK(id GLOB 'PER-*'),
 full_name TEXT NOT NULL CHECK(length(full_name) BETWEEN 1 AND 120),
 department TEXT NOT NULL,
 position TEXT CHECK(position IS NULL OR length(position) BETWEEN 1 AND 80),
 officer INTEGER NOT NULL DEFAULT 0 CHECK(officer IN (0, 1)),
 student_id TEXT UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
 account_id TEXT UNIQUE REFERENCES staff_accounts(id),
 source_key TEXT UNIQUE,
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id),
 updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES staff_accounts(id)
);

CREATE TABLE staff_id_cards (
 person_id TEXT PRIMARY KEY REFERENCES staff_directory(id),
 media_id TEXT NOT NULL UNIQUE CHECK(length(media_id) = 36),
 front_width INTEGER NOT NULL CHECK(front_width BETWEEN 1 AND 2000),
 front_height INTEGER NOT NULL CHECK(front_height BETWEEN 1 AND 2000),
 back_width INTEGER NOT NULL CHECK(back_width BETWEEN 1 AND 2000),
 back_height INTEGER NOT NULL CHECK(back_height BETWEEN 1 AND 2000),
 source_front TEXT,
 source_back TEXT,
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id)
);

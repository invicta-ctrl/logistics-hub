-- V1.2: one primary profile photo per item. The image objects live in the CATALOG_MEDIA R2 bucket
-- (items/<media_id>/display and items/<media_id>/thumb); this row is the only reference to them, and a
-- replacement gets a new media_id so a stored image is never overwritten in place.
-- Additive only: the code live before this change ignores the table.
CREATE TABLE item_media (
 item_id TEXT PRIMARY KEY REFERENCES items(id),
 media_id TEXT NOT NULL UNIQUE CHECK(length(media_id) = 36),
 width INTEGER NOT NULL CHECK(width BETWEEN 1 AND 1600),
 height INTEGER NOT NULL CHECK(height BETWEEN 1 AND 1600),
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id)
);

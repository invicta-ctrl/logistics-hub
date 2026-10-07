-- V1.11: explicit links between two items that staff set, for search and the item's own record. Additive only: the code live before
-- this change ignores it, and nothing here changes an item, its stock, a place, a kit or a loan.
-- A pair of items is linked once, by one kind. ALTERNATIVE and USED_WITH read the same from both ends. REPLACEMENT reads "item_id is
-- replaced by related_id". CONTENTS reads "item_id (the container) holds related_id (what goes in it)": a gas cylinder and its LPG
-- are two records with one link (catalog intelligence amendment §7). Kit components and places are links the records already hold.
CREATE TABLE item_relationships (
 item_id TEXT NOT NULL REFERENCES items(id),
 related_id TEXT NOT NULL REFERENCES items(id),
 kind TEXT NOT NULL CHECK(kind IN ('ALTERNATIVE','REPLACEMENT','USED_WITH','CONTENTS')),
 created_at TEXT NOT NULL,
 created_by TEXT REFERENCES staff_accounts(id),
 CHECK(item_id <> related_id),
 PRIMARY KEY(item_id, related_id)
);
-- Whichever end it was set from, a pair is linked once.
CREATE UNIQUE INDEX idx_item_relationships_pair ON item_relationships(min(item_id, related_id), max(item_id, related_id));
-- An item's links are read from both ends (the primary key serves item_id).
CREATE INDEX idx_item_relationships_related ON item_relationships(related_id);

-- V1.16.7: durable, photo-keyed cleanup journal for retention and immutable thumbnail revocation.
-- An erased thumbnail key remains in R2 as an inert marker; this D1 row is its enduring reference.
CREATE TABLE retention_photo_cleanup (
  photo_key TEXT PRIMARY KEY,
  queued_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX idx_retention_photo_cleanup_pending ON retention_photo_cleanup(completed_at, queued_at);

-- A queued photo must never acquire a new reference while its private contents are being erased.
CREATE TRIGGER retention_loan_photo_no_reuse_insert
BEFORE INSERT ON loans
WHEN NEW.photo_key <> '' AND EXISTS (SELECT 1 FROM retention_photo_cleanup WHERE photo_key = NEW.photo_key)
BEGIN SELECT RAISE(ABORT, 'photo_retention_queued'); END;
CREATE TRIGGER retention_loan_photo_no_reuse_update
BEFORE UPDATE OF photo_key ON loans
WHEN NEW.photo_key <> '' AND NEW.photo_key IS NOT OLD.photo_key AND EXISTS (SELECT 1 FROM retention_photo_cleanup WHERE photo_key = NEW.photo_key)
BEGIN SELECT RAISE(ABORT, 'photo_retention_queued'); END;
CREATE TRIGGER retention_phone_photo_no_reuse_insert
BEFORE INSERT ON self_service_events
WHEN NEW.photo_key IS NOT NULL AND NEW.photo_key <> '' AND EXISTS (SELECT 1 FROM retention_photo_cleanup WHERE photo_key = NEW.photo_key)
BEGIN SELECT RAISE(ABORT, 'photo_retention_queued'); END;
CREATE TRIGGER retention_phone_photo_no_reuse_update
BEFORE UPDATE OF photo_key ON self_service_events
WHEN NEW.photo_key IS NOT NULL AND NEW.photo_key <> '' AND NEW.photo_key IS NOT OLD.photo_key AND EXISTS (SELECT 1 FROM retention_photo_cleanup WHERE photo_key = NEW.photo_key)
BEGIN SELECT RAISE(ABORT, 'photo_retention_queued'); END;

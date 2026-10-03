-- The audit log is append-only, like the movement ledger (0009): who changed what is never edited or removed afterwards;
-- a correction is a new entry. Additive: no row changes, and no code updates or deletes audit_log.
-- Should an accepted spec ever require erasing an identity from audit entries, it replaces these triggers with one that
-- allows exactly that erasure, as 0019 did for settled phone records.
CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;

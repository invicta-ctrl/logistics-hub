-- V1.4.1: a report from a phone names who sent it, the way a take or borrow on Self-Service already does, so staff can ask them.
-- Additive: the live code ignores the column. Reports already recorded keep NULL ("no name given"). The guard that makes a report
-- final is recreated to cover the new column too.
ALTER TABLE location_reports ADD COLUMN reporter_name TEXT CHECK(reporter_name IS NULL OR length(reporter_name) BETWEEN 1 AND 120);

DROP TRIGGER location_reports_resolve_only;
CREATE TRIGGER location_reports_resolve_only BEFORE UPDATE ON location_reports
WHEN OLD.resolved_at IS NOT NULL OR NEW.id IS NOT OLD.id OR NEW.item_id IS NOT OLD.item_id OR NEW.location_id IS NOT OLD.location_id OR NEW.kind IS NOT OLD.kind
 OR NEW.source IS NOT OLD.source OR NEW.note IS NOT OLD.note OR NEW.reported_by IS NOT OLD.reported_by OR NEW.reporter_name IS NOT OLD.reporter_name
 OR NEW.client_tag IS NOT OLD.client_tag OR NEW.created_at IS NOT OLD.created_at
BEGIN SELECT RAISE(ABORT, 'location_report_final'); END;

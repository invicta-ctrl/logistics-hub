-- Part 6.4: the Owner can erase who a long-settled phone record was (name, student ID, photo).
-- 0015 made a resolved phone record fully immutable. This keeps that for every column, and allows
-- exactly one change: the identity replaced by the erased marker ('[removed]', no student ID, no
-- photo), never anything else. The record itself (item, quantity, times, decision) stays, so a late
-- resend from a phone is still recognised by its id.
-- Additive for the code already live: nothing it does changes a resolved record's identity.
DROP TRIGGER self_service_events_resolved_final;
CREATE TRIGGER self_service_events_resolved_final BEFORE UPDATE ON self_service_events
WHEN OLD.resolved_at IS NOT NULL AND NOT (
 NEW.id IS OLD.id AND NEW.device_id IS OLD.device_id AND NEW.seq IS OLD.seq AND NEW.event_type IS OLD.event_type AND NEW.item_id IS OLD.item_id
 AND NEW.quantity IS OLD.quantity AND NEW.purpose IS OLD.purpose AND NEW.reason IS OLD.reason AND NEW.return_outcome IS OLD.return_outcome
 AND NEW.note IS OLD.note AND NEW.return_by IS OLD.return_by AND NEW.loan_event_id IS OLD.loan_event_id AND NEW.device_time IS OLD.device_time
 AND NEW.sent_at IS OLD.sent_at AND NEW.occurred_at IS OLD.occurred_at AND NEW.received_at IS OLD.received_at AND NEW.client_tag IS OLD.client_tag
 AND NEW.catalog_revision IS OLD.catalog_revision AND NEW.loan_id IS OLD.loan_id AND NEW.movement_id IS OLD.movement_id AND NEW.applied IS OLD.applied
 AND NEW.review IS OLD.review AND NEW.resolved_at IS OLD.resolved_at AND NEW.resolved_by IS OLD.resolved_by AND NEW.resolution_note IS OLD.resolution_note
 AND NEW.person_name = '[removed]' AND NEW.student_id IS NULL AND NEW.photo_key IS NULL)
BEGIN
 SELECT RAISE(ABORT, 'self_service_event_resolved');
END;

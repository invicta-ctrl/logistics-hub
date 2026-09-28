-- Item detail reads one item's catalog history (audit_log) next to its movements.
-- Index only: no data is rewritten and quantity stays movement-derived.
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_item ON audit_log(entity_type, entity_id, created_at);

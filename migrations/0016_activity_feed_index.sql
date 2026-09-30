-- Activity feed ordering (Part 5). Index-only: no table or row changes. Each key is the feed's canonical UTC instant
-- (text offsets normalized; a non-date becomes the oldest sentinel), so a page is an index walk, not a scan and sort.
CREATE INDEX IF NOT EXISTS idx_activity_movements ON inventory_movements((COALESCE(CASE WHEN created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at) END, '0000-01-01T00:00:00.000Z')), id);
CREATE INDEX IF NOT EXISTS idx_activity_audit ON audit_log((COALESCE(CASE WHEN created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at) END, '0000-01-01T00:00:00.000Z')), id);
CREATE INDEX IF NOT EXISTS idx_activity_audit_item ON audit_log(entity_type, (COALESCE(CASE WHEN created_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', created_at) END, '0000-01-01T00:00:00.000Z')), id);
CREATE INDEX IF NOT EXISTS idx_activity_phone ON self_service_events((COALESCE(CASE WHEN occurred_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', occurred_at) END, '0000-01-01T00:00:00.000Z')), id)
  WHERE (review IS NOT NULL OR event_type = 'RETURN' OR applied = 0);
CREATE INDEX IF NOT EXISTS idx_activity_resolved ON self_service_events((COALESCE(CASE WHEN resolved_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*' THEN strftime('%Y-%m-%dT%H:%M:%fZ', resolved_at) END, '0000-01-01T00:00:00.000Z')), id)
  WHERE resolved_at IS NOT NULL;

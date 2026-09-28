-- migration_delta is reconciliation evidence: the legacy snapshot compared with
-- the *migrated* ledger. Staff movements recorded later change on_hand but must
-- never change (or invent) that evidence. Live quantity is still every POSTED movement.
DROP VIEW IF EXISTS inventory_balances;
CREATE VIEW inventory_balances AS
SELECT
 i.id,
 i.name,
 i.unit,
 COALESCE(SUM(CASE WHEN m.status='POSTED' THEN m.signed_quantity ELSE 0 END),0) AS on_hand,
 COALESCE(SUM(CASE WHEN m.status='POSTED' THEN m.signed_quantity ELSE 0 END),0) AS available,
 COALESCE(SUM(CASE WHEN m.status='POSTED' AND m.imported_from IS NOT NULL THEN m.signed_quantity ELSE 0 END),0) AS migrated_on_hand,
 i.legacy_reported_opening_qty,
 i.legacy_reported_reserved_qty,
 i.legacy_reported_available_qty,
 CASE
   WHEN i.legacy_reported_available_qty IS NULL THEN NULL
   ELSE COALESCE(SUM(CASE WHEN m.status='POSTED' AND m.imported_from IS NOT NULL THEN m.signed_quantity ELSE 0 END),0) - i.legacy_reported_available_qty
 END AS migration_delta
FROM items i
LEFT JOIN inventory_movements m ON m.item_id=i.id
GROUP BY i.id;

-- The last active Owner can never be removed (review finding R1, accepted amendment 2026-10-03-review-hardening).
-- The Worker's count before the write gives the friendly message; these triggers make the rule hold for every writer and
-- every race: of two requests that would each leave the other Owner as the last, D1 runs the second batch after the first
-- commits, this trigger aborts it, and its whole batch (sessions, keys, audit) rolls back with it.
-- Additive: no row changes. Creating accounts and adding the first Owner are untouched; only removing an active Owner when
-- no other remains is refused. A later rebuild of staff_accounts must recreate both triggers.
CREATE TRIGGER IF NOT EXISTS staff_accounts_keep_owner BEFORE UPDATE OF role, active ON staff_accounts
WHEN OLD.role = 'OWNER' AND OLD.active = 1 AND (NEW.role <> 'OWNER' OR NEW.active = 0)
 AND NOT EXISTS (SELECT 1 FROM staff_accounts WHERE role = 'OWNER' AND active = 1 AND id <> OLD.id)
BEGIN SELECT RAISE(ABORT, 'last_active_owner'); END;
CREATE TRIGGER IF NOT EXISTS staff_accounts_keep_owner_on_delete BEFORE DELETE ON staff_accounts
WHEN OLD.role = 'OWNER' AND OLD.active = 1
 AND NOT EXISTS (SELECT 1 FROM staff_accounts WHERE role = 'OWNER' AND active = 1 AND id <> OLD.id)
BEGIN SELECT RAISE(ABORT, 'last_active_owner'); END;

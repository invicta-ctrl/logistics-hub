-- Part 6.3: settings an administrator can change without a deploy. One row per setting; the Worker
-- audits every change. The only setting today is whether phone Self-Service is open.
-- Self-Service has been closed for maintenance on production since 2026-10-02 (PR #8, wrangler.jsonc
-- "SELF_SERVICE": "paused"), so it is seeded closed and the deploy that reads this table cannot reopen it.
-- Additive only: the code live before this change ignores the table.
CREATE TABLE system_settings (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 updated_by TEXT REFERENCES staff_accounts(id),
 CHECK(key <> 'self_service' OR value IN ('open', 'paused'))
);
INSERT INTO system_settings(key, value, updated_at) VALUES('self_service', 'paused', '2026-10-02T00:00:00.000Z');

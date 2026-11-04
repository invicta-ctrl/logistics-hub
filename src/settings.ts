// System settings (Part 6.3): values an administrator can change without a deploy.
import type { Account } from "./accounts";
import { BUMP_REVISION, InputError, audit } from "./inventory";

export type SelfServiceState = "open" | "paused";

/** Closed unless the stored value says "open": a missing setting fails closed on a public write path. */
export async function selfServiceState(db: D1Database): Promise<SelfServiceState> {
  return await db.prepare("SELECT value FROM system_settings WHERE key = 'self_service'").first<string>("value") === "open" ? "open" : "paused";
}

/**
 * Setting it to its current value changes nothing and writes no audit entry. A real change moves the catalog revision (V1.16.8): the
 * public catalog says whether Self-Service is open, so a Lending Hub holding the old tag must not be told 304.
 */
export async function setSelfService(db: D1Database, actor: Account, input: unknown) {
  const state = (input as { state?: unknown } | null)?.state;
  if (state !== "open" && state !== "paused") throw new InputError(400, 'Choose "open" or "paused".');
  await db.batch([
    db.prepare("UPDATE system_settings SET value = ?1, updated_at = ?2, updated_by = ?3 WHERE key = 'self_service' AND value <> ?1").bind(state, new Date().toISOString(), actor.accountId),
    audit(db, actor.accountId, "SETTING_CHANGED", "SETTING", "self_service", { setting: "self_service", from: state === "open" ? "paused" : "open", to: state }, true),
    // The audit row is written only after a real change, so it carries that change to the bump.
    db.prepare(`${BUMP_REVISION} AND changes() > 0`)
  ]);
  return { state: await selfServiceState(db) };
}

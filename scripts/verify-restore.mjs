// Checks a restored (or about-to-be-restored) database against what the code expects, from a `wrangler d1 export` dump, read-only and local:
//   node scripts/verify-restore.mjs <dump.sql> [--keys <file>]
// The dump is loaded into a private in-memory database; nothing is sent anywhere. Pass --keys, a text file with one R2 object key per line
// (the catalog, evidence and staff-ID buckets together), to also find media the database names that is gone, and media nothing names.
// A key list does not verify object contents or marker metadata. Pending cleanup is recoverable, but must still be drained.
// The dump holds personal data: keep it under data/private/ (docs/DEPLOYMENT.md, "Backups and restore").
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const VARIANTS = ["display", "thumb"];
const migrationsDir = fileURLToPath(new URL("../migrations/", import.meta.url));

function pendingCleanupKeys(sqlite) {
  if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'retention_photo_cleanup'").get()) return new Set();
  return new Set(sqlite.prepare("SELECT photo_key FROM retention_photo_cleanup WHERE completed_at IS NULL").all().map((row) => row.photo_key));
}

/** The R2 keys the database's rows name and that must exist. */
export function referencedKeys(sqlite) {
  const column = (sql) => sqlite.prepare(sql).all().map((row) => Object.values(row)[0]);
  const keys = new Set();
  for (const [table, folder] of [["item_media", "items"], ["locations", "locations"], ["kits", "kits"]]) {
    for (const id of column(`SELECT media_id FROM ${table} WHERE media_id IS NOT NULL`)) for (const variant of VARIANTS) keys.add(`${folder}/${id}/${variant}`);
  }
  for (const id of column("SELECT media_id FROM staff_id_cards")) { keys.add(`ids/${id}/front`); keys.add(`ids/${id}/back`); }
  // Pending cleanup may already have removed the original while its row is still waiting to be cleared.
  const pending = pendingCleanupKeys(sqlite);
  for (const key of column("SELECT photo_key FROM loans WHERE photo_key IS NOT NULL AND photo_key <> '' UNION SELECT photo_key FROM self_service_events WHERE photo_key IS NOT NULL AND photo_key <> ''")) if (!pending.has(key)) keys.add(key);
  // A completed retention journal is the sole D1 reference to its permanent inert R2 thumbnail marker.
  if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'retention_photo_cleanup'").get()) {
    for (const key of column("SELECT photo_key FROM retention_photo_cleanup WHERE completed_at IS NOT NULL")) keys.add(`${key}.thumb`);
  }
  return keys;
}

/** Keys that may exist beside the required ones: a card's two small images made in the browser (src/staff-directory.ts). Present is fine, absent is fine. */
export function optionalKeys(sqlite) {
  const keys = new Set();
  for (const { media_id: id } of sqlite.prepare("SELECT media_id FROM staff_id_cards").all()) { keys.add(`ids/${id}/thumb`); keys.add(`ids/${id}/face`); }
  // An active loan may not yet have a browser-derived thumbnail; a pending cleanup might not have reached R2.
  for (const { photo_key: key } of sqlite.prepare("SELECT photo_key FROM loans WHERE photo_key <> ''").all()) keys.add(`${key}.thumb`);
  for (const key of pendingCleanupKeys(sqlite)) { keys.add(key); keys.add(`${key}.thumb`); }
  return keys;
}

/** Everything wrong with the database; an empty list means the checks passed. `stored` is the set of R2 keys, or null when it was not given. */
export function checkRestore(sqlite, { migrations, stored = null }) {
  const problems = [];
  const integrity = sqlite.prepare("PRAGMA integrity_check").all().map((row) => Object.values(row)[0]);
  if (integrity.length !== 1 || integrity[0] !== "ok") problems.push(`integrity_check: ${integrity.slice(0, 3).join("; ")}`);
  const pending = pendingCleanupKeys(sqlite).size;
  if (pending) problems.push(`${pending} pending retention photo cleanup job(s); drain and recheck before enabling traffic`);
  // A completed job cannot retain a photo reference, even if both objects appear in an R2 key list.
  if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'retention_photo_cleanup'").get()) {
    const conflicting = sqlite.prepare(`SELECT COUNT(*) AS n FROM retention_photo_cleanup AS cleanup
      WHERE cleanup.completed_at IS NOT NULL AND
        (EXISTS (SELECT 1 FROM loans WHERE photo_key = cleanup.photo_key)
          OR EXISTS (SELECT 1 FROM self_service_events WHERE photo_key = cleanup.photo_key))`).get().n;
    if (conflicting) problems.push(`${conflicting} completed retention photo cleanup key(s) still referenced by loan or phone records`);
  }
  const broken = sqlite.prepare("PRAGMA foreign_key_check").all();
  if (broken.length) problems.push(`${broken.length} row(s) point at a row that is not there (first: ${broken[0].table} -> ${broken[0].parent})`);
  const applied = new Set(sqlite.prepare("SELECT name FROM d1_migrations").all().map((row) => row.name));
  const missing = migrations.filter((name) => !applied.has(name));
  const unknown = [...applied].filter((name) => !migrations.includes(name));
  if (missing.length) problems.push(`migrations this code carries but the database lacks: ${missing.join(", ")}`);
  if (unknown.length) problems.push(`migrations the database has but this code does not: ${unknown.join(", ")}`);
  const unbalanced = sqlite.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE status = 'POSTED' AND signed_quantity IS NULL").get().n;
  if (unbalanced) problems.push(`${unbalanced} posted movement(s) with no signed quantity`);
  if (stored) {
    const named = referencedKeys(sqlite);
    const gone = [...named].filter((key) => !stored.has(key));
    const allowed = optionalKeys(sqlite);
    const orphans = [...stored].filter((key) => !named.has(key) && !allowed.has(key));
    if (gone.length) problems.push(`${gone.length} object(s) the database names are not in R2 (first: ${gone[0]})`);
    if (orphans.length) problems.push(`${orphans.length} object(s) in R2 that no row names (first: ${orphans[0]})`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [dump] = process.argv.slice(2);
  const keysFile = process.argv.includes("--keys") ? process.argv[process.argv.indexOf("--keys") + 1] : null;
  if (!dump) { console.error("Usage: node scripts/verify-restore.mjs <dump.sql> [--keys <file>]"); process.exit(2); }
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = OFF");
  sqlite.exec(fs.readFileSync(dump, "utf8"));
  const stored = keysFile ? new Set(fs.readFileSync(keysFile, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) : null;
  const problems = checkRestore(sqlite, { migrations: fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort(), stored });
  const count = (table) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  console.log(JSON.stringify({ items: count("items"), movements: count("inventory_movements"), loans: count("loans"), staffAccounts: count("staff_accounts"), selfServiceEvents: count("self_service_events"), mediaNamed: referencedKeys(sqlite).size, retentionPending: pendingCleanupKeys(sqlite).size, r2Checked: Boolean(stored) }, null, 2));
  if (problems.length) { for (const problem of problems) console.error(`PROBLEM: ${problem}`); process.exit(1); }
  console.log("RESTORE_OK");
}

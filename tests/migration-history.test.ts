// A migration that production has applied is history: D1 never re-runs it, so editing it only makes a fresh
// database (local, tests, a restore) differ from production. Changes ship as a new, numbered migration.
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

/** Applied to production before the Cloud Operations lane pinned migrations in ops/releases/<release>.json. */
const APPLIED_BEFORE_RELEASE_MANIFESTS: Record<string, string> = {
  "0001_core.sql": "9e27ea8463dc9fcefbc9d5ada6404bc04e887af63d17a5b4554f3911e2fe0cfd",
  "0002_inventory_seed.sql": "43d6537ac544f9e8f4002d49bfeec909f7f2be9a7ccdb80373b305617eda3b14",
  "0003_inventory_seed_part_02.sql": "1bdf6fe04b3af1523cb359554dc4066c9a37877889aa20fa1498ae133376cd5b",
  "0004_inventory_seed_part_03.sql": "1f80b53a5577fbffa61fa5db37229f2ee130ecb78b687eaa1f1c398148cbf321",
  "0005_inventory_seed_part_04.sql": "d11ecff88afefb190de8fc012379f360000057594492bfff372fb7ed8eeae822",
  "0006_inventory_seed_part_05.sql": "462db08b74b0b4033ed5a7f9c49e3ce2a671c2b9e184e40cdc00daf85d671e9c",
  "0007_inventory_seed_part_06.sql": "413474b4b5e8bcb8e4ac9501a74afe9ca7a33d188ad3c25c411f81e1393af3f6",
  "0008_staff_sessions.sql": "2117735b7caf09945ebbba6269911eb8e4ffb6446b51aa414b94cbc43309d99e",
  "0009_staff_accounts_and_revision.sql": "32f2fe75fc9581623c403446a80a02e20412007d9237a9bccb114175bc579cbc",
  "0010_migration_evidence_view.sql": "96a8f66c8999235401383a83b8d4366463d4652abed2a95afb9adb68931d5e86",
  "0011_roles_and_owner_recovery.sql": "6039e102ce096c3d40db85cadccce0bea45ee5d2058816d8ea3c2c0b285b5041",
  "0012_item_history_index.sql": "53bf67442d7bda73b40b47d687c6742cdb87f6dffd5eef3ba1abab3d1853f303",
  "0013_stock_and_pantry.sql": "1c292a968e73146c3d34be26eabaa961b51d6b48ca38875102b9f9580e6f5f96",
  "0014_internal_lending.sql": "1dd73ef80a2e5dcc7e67637ce12c5e02b3a2604dbea0c11e46051b2c27c9da51",
  "0015_self_service.sql": "1919d89b94f44340dbc47791848c21d30c914b73a3e37d59dadaf370b08eb1c7",
  "0016_activity_feed_index.sql": "50ce8a76f622bf83a2bfcd87a4c6feccceff5a424a8f8d7132340fe0ff7e2902",
  "0017_open_units.sql": "cdd3baf6ff37e5276131b20d0a6ba3d51378fc6f6bf1250a6bb52fad9984c312",
  "0018_system_settings.sql": "20286674e2e8f7a48c1d1730e3c99604998d9492857746bf055ae1da4c705a90",
  "0019_retention_erasure.sql": "3930f388daf3e0fad18d36c683c67c290dae5c49d5f1c92f0bf57da4a2e56ea3"
};

/** Every migration a release manifest pins (production-release.mjs refuses a file whose hash differs). */
function releasePins(): Array<[string, string, string]> {
  return fs.readdirSync("ops/releases").filter((file) => file.endsWith(".json")).flatMap((file) => {
    const manifest = JSON.parse(fs.readFileSync(`ops/releases/${file}`, "utf8")) as { migrations?: { pending?: Array<{ name: string; sha256: string }> } };
    return (manifest.migrations?.pending ?? []).map(({ name, sha256 }): [string, string, string] => [file, name, sha256]);
  });
}

// The repository stores LF; a Windows checkout may convert to CRLF, which is the same migration.
const sha256 = (file: string) => createHash("sha256").update(fs.readFileSync(`migrations/${file}`, "utf8").replace(/\r\n/g, "\n")).digest("hex");

describe("migration history", () => {
  const files = fs.readdirSync("migrations").sort();

  it("holds only numbered SQL migrations, numbered 0001 upwards with no gap or repeat", () => {
    // A repeat is what two branches each adding "the next" migration produce; renumber the later one before it merges.
    expect(files.every((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)), files.join(", ")).toBe(true);
    expect(files.map((file) => Number(file.slice(0, 4)))).toEqual(files.map((_, index) => index + 1));
  });

  it("never edits a migration production has applied", () => {
    for (const [file, pinned] of Object.entries(APPLIED_BEFORE_RELEASE_MANIFESTS)) expect(sha256(file), file).toBe(pinned);
  });

  it("never edits a migration a release manifest pins", () => {
    const pins = releasePins();
    expect(pins.length).toBeGreaterThan(0);
    for (const [manifest, file, pinned] of pins) {
      expect(files, `${manifest} pins ${file}`).toContain(file);
      expect(sha256(file), `${manifest}: ${file}`).toBe(pinned);
    }
  });
});

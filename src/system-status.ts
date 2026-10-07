// What Administration > System reports (V1.13): the running build, the database's migration level and whether the database, the
// three R2 buckets and Self-Service answer right now. Every figure is read from the thing it describes: nothing is assumed healthy.
import { selfServiceState } from "./settings";

export type Probe = { ok: boolean; ms: number };
export type Build = { version: string; commit: string | null; builtAt: string; migrations: string[] };
export type MigrationLevel = {
  applied: number;
  latest: string | null;
  /** When the latest one was recorded as applied (UTC, ISO). */
  latestAppliedAt: string | null;
  /** Migrations this build carries that the database has not applied; null when the build's list is not known. */
  pending: string[] | null;
};
export type SystemStatus = {
  checkedAt: string;
  build: Build | null;
  database: Probe & { migrations: MigrationLevel | null };
  storage: Array<Probe & { id: string; label: string; holds: string }>;
  selfService: "open" | "paused" | null;
};

type Bindings = { DB: D1Database; ASSETS: Fetcher; EVIDENCE: R2Bucket; CATALOG_MEDIA: R2Bucket; STAFF_IDS: R2Bucket };

/** Each check is given this long. A slow service is reported as not answering rather than holding the page. */
export const PROBE_LIMIT_MS = 2_000;

/** Runs one check. Only that it finished and how long it took leave this function: an error's text is never passed on. */
async function probe<T>(name: string, check: () => Promise<T>): Promise<{ ok: true; ms: number; value: T } | { ok: false; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([check(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), PROBE_LIMIT_MS); })]);
    return { ok: true, ms: Date.now() - started, value };
  } catch {
    console.error("health_probe_failed", { check: name });
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/** The build's own record (vite.config.ts). A missing or unreadable one means "unknown", which is what the page then says. */
function readBuild(value: unknown): Build | null {
  const record = value as Partial<Record<keyof Build, unknown>> | null;
  if (!record || typeof record.version !== "string" || !/^[0-9a-f]{12}$/.test(record.version)) return null;
  if (typeof record.builtAt !== "string" || Number.isNaN(Date.parse(record.builtAt))) return null;
  if (!Array.isArray(record.migrations) || !record.migrations.every((name) => typeof name === "string" && /^\d{4}_[a-z0-9_]+\.sql$/.test(name))) return null;
  const commit = typeof record.commit === "string" && /^[0-9a-f]{40}$/.test(record.commit) ? record.commit : null;
  return { version: record.version, commit, builtAt: record.builtAt, migrations: record.migrations as string[] };
}

async function readMigrations(db: D1Database, expected: string[] | null): Promise<MigrationLevel> {
  const { results } = await db.prepare("SELECT name, applied_at AS appliedAt FROM d1_migrations ORDER BY id").all<{ name: string; appliedAt: string | null }>();
  const names = new Set(results.map((row) => row.name));
  const latest = results.at(-1);
  // wrangler records the time as "YYYY-MM-DD HH:MM:SS", in UTC.
  const at = latest?.appliedAt && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(latest.appliedAt) ? `${latest.appliedAt.replace(" ", "T")}Z` : null;
  return { applied: results.length, latest: latest?.name ?? null, latestAppliedAt: at, pending: expected ? expected.filter((name) => !names.has(name)) : null };
}

export const BUCKETS = [
  { id: "EVIDENCE", label: "Loan photos", holds: "Photos taken when something is lent. Staff only." },
  { id: "CATALOG_MEDIA", label: "Catalog pictures", holds: "Item and place pictures." },
  { id: "STAFF_IDS", label: "Staff ID scans", holds: "Official ID scans for the Staff Directory. Administration only." }
] as const;

export async function systemStatus(env: Bindings, origin: string): Promise<SystemStatus> {
  const buildProbe = probe("build", async () => readBuild(await (await env.ASSETS.fetch(new Request(new URL("/build.json", origin)))).json().catch(() => null)));
  const build = await buildProbe;
  const known = build.ok ? build.value : null;
  const [ping, migrations, state, ...buckets] = await Promise.all([
    probe("database", () => env.DB.prepare("SELECT 1 AS ok").first()),
    probe("migrations", () => readMigrations(env.DB, known?.migrations ?? null)),
    probe("self-service", () => selfServiceState(env.DB)),
    // A key that never exists: the answer is "nothing there", which proves the bucket is reachable and costs no data.
    ...BUCKETS.map((bucket) => probe(bucket.id, () => env[bucket.id].get("health-check-never-stored")))
  ]);
  return {
    checkedAt: new Date().toISOString(),
    build: known,
    database: { ok: ping.ok, ms: ping.ms, migrations: migrations.ok ? migrations.value : null },
    storage: BUCKETS.map((bucket, index) => ({ ...bucket, ok: buckets[index]!.ok, ms: buckets[index]!.ms })),
    selfService: state.ok ? state.value : null
  };
}

import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";

function environment(rows = [{ id: "ITM-0001", name: "Reviewed asset", category: "Equipment", itemType: "EQUIPMENT", unit: "piece", status: "ACTIVE", needsReview: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", onHand: 2 }], settings: Partial<Env> = {}): Env {
  const sessions = new Set<string>();
  return {
    DB: {
      prepare: (query: string) => ({
        bind: (...bindings: unknown[]) => ({
          all: async () => ({ results: rows }),
          first: async () => query.startsWith("SELECT id FROM staff_sessions") && sessions.has(String(bindings[0])) ? { id: String(bindings[0]) } : null,
          run: async () => {
            if (query.startsWith("INSERT INTO staff_sessions")) sessions.add(String(bindings[0]));
            if (query.startsWith("UPDATE staff_sessions")) sessions.delete(String(bindings[0]));
            return { success: true };
          }
        })
      })
    } as unknown as D1Database,
    ASSETS: { fetch: async () => new Response("asset") } as unknown as Fetcher,
    SESSION_SECRET: "test-secret",
    ...settings
  };
}

describe("worker public and staff boundaries", () => {
  it("maps public catalog data to a safe DTO", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/public/catalog"), environment());
    const body = await response.json() as { items: Array<Record<string, unknown>> };
    expect(body.items[0]).toMatchObject({ name: "Reviewed asset", availableToBorrow: true, lendingAvailability: "available" });
    expect(body.items[0]).not.toHaveProperty("needsReview");
    expect(body.items[0]).not.toHaveProperty("onHand");
    expect(body.items[0]).not.toHaveProperty("lendingAudience");
  });

  it("returns the complete current catalog and its full category set", async () => {
    const rows = Array.from({ length: 397 }, (_, index) => ({ id: `ITM-${String(index + 1).padStart(4, "0")}`, name: `Asset ${index + 1}`, category: index === 396 ? "Late catalog category" : "Early catalog category", itemType: "EQUIPMENT", unit: "piece", status: "ACTIVE", needsReview: 0, lendingAudience: "STUDENTS_AND_USC_STAFF", onHand: 1 }));
    const response = await worker.fetch(new Request("https://example.test/api/public/catalog"), environment(rows));
    const body = await response.json() as { items: unknown[]; categories: string[] };
    expect(body.items).toHaveLength(397);
    expect(body.categories).toEqual(["Early catalog category", "Late catalog category"]);
  });

  it("keeps unreviewed inventory non-borrowable", async () => {
    const response = await worker.fetch(new Request("https://example.test/api/public/catalog"), environment([{ id: "ITM-0001", name: "Unreviewed asset", category: "Equipment", itemType: "EQUIPMENT", unit: "piece", status: "ACTIVE", needsReview: 1, lendingAudience: "STUDENTS_AND_USC_STAFF", onHand: 2 }]));
    const body = await response.json() as { items: Array<{ availableToBorrow: boolean; lendingAvailability: string }> };
    expect(body.items[0]).toEqual({ id: "ITM-0001", name: "Unreviewed asset", category: "Equipment", itemType: "EQUIPMENT", unit: "piece", availableToBorrow: false, lendingAvailability: "unavailable" });
  });

  it("rejects unauthorized staff APIs and direct staff-shell routes", async () => {
    const env = environment();
    await expect(worker.fetch(new Request("https://example.test/api/staff/session"), env)).resolves.toMatchObject({ status: 401 });
    const home = await worker.fetch(new Request("https://example.test/staff/home/deeper"), env);
    expect(home.status).toBe(302);
    expect(home.headers.get("location")).toBe("https://example.test/staff");
  });

  it("requires a same-origin loopback development gate and revokes a logout session", async () => {
    const env = environment(undefined, { ENVIRONMENT: "development", DEV_AUTH_ENABLED: "true", DEV_STAFF_USERNAME: "test-user", DEV_STAFF_PASSWORD: "test-password" });
    const deniedOrigin = await worker.fetch(new Request("http://127.0.0.1:8791/api/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "test-user", password: "test-password" }) }), env);
    expect(deniedOrigin.status).toBe(403);
    const deniedHost = await worker.fetch(new Request("https://example.test/api/staff/login", { method: "POST", headers: { origin: "https://example.test", "content-type": "application/json" }, body: JSON.stringify({ username: "test-user", password: "test-password" }) }), env);
    expect(deniedHost.status).toBe(503);
    const origin = "http://127.0.0.1:8791";
    const login = await worker.fetch(new Request(`${origin}/api/staff/login`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ username: "test-user", password: "test-password" }) }), env);
    expect(login.status).toBe(200);
    const replayCookie = login.headers.get("set-cookie")!.split(";")[0];
    await expect(worker.fetch(new Request(`${origin}/api/staff/session`, { headers: { cookie: replayCookie } }), env)).resolves.toMatchObject({ status: 200 });
    const logout = await worker.fetch(new Request(`${origin}/api/staff/logout`, { method: "POST", headers: { origin, cookie: replayCookie } }), env);
    expect(logout.status).toBe(200);
    await expect(worker.fetch(new Request(`${origin}/api/staff/session`, { headers: { cookie: replayCookie } }), env)).resolves.toMatchObject({ status: 401 });
  });

  it("does not route unknown or unsupported API calls into the static application", async () => {
    const env = environment();
    await expect(worker.fetch(new Request("https://example.test/api/no-request-workflow"), env)).resolves.toMatchObject({ status: 404 });
    await expect(worker.fetch(new Request("https://example.test/api/public/catalog", { method: "POST" }), env)).resolves.toMatchObject({ status: 405 });
  });
});

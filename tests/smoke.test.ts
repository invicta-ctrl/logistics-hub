import { describe, expect, it } from "vitest";
import { entryBundle, smoke, smokeOnce } from "../scripts/ops/smoke.mjs";

const bundle = "/assets/main-DtRBHjiH.js";
const page = (src: string) => `<script src="/theme-boot.js"></script><script type="module" crossorigin src="${src}"></script>`;
const site = (routes: Record<string, { status: number; text: string }>) => async (url: string) => routes[new URL(url).pathname] ?? { status: 404, text: "" };
const healthy = { "/": { status: 200, text: page(bundle) }, [bundle]: { status: 200, text: "export{}" }, "/api/public/catalog": { status: 200, text: '{"items":[]}' } };
const base = "https://logistics.example";

describe("post-deploy smoke check (LH-CD-01)", () => {
  it("reads the module entry bundle, not the plain boot script", () => {
    expect(entryBundle(page(bundle))).toBe(bundle);
    expect(entryBundle("<html></html>")).toBeNull();
  });

  it("passes only when the live page loads this build's bundle and the public catalog answers", async () => {
    expect(await smokeOnce(base, bundle, site(healthy))).toBeNull();
    expect(await smokeOnce(base, bundle, site({ ...healthy, "/": { status: 200, text: page("/assets/main-OLD.js") } }))).toMatch(/not this build's/);
    expect(await smokeOnce(base, bundle, site({ ...healthy, "/": { status: 503, text: "" } }))).toBe("home page answered 503");
    expect(await smokeOnce(base, bundle, site({ ...healthy, "/api/public/catalog": { status: 500, text: "" } }))).toBe("public catalog answered 500");
    expect(await smokeOnce(base, bundle, site({ ...healthy, "/api/public/catalog": { status: 200, text: "<html>" } }))).toBe("public catalog is not JSON");
  });

  it("waits out propagation, and reports the last reason when the site never becomes healthy", async () => {
    let calls = 0;
    const slow = async (url: string) => { if (new URL(url).pathname === "/") calls += 1; return site(calls < 3 ? { ...healthy, "/": { status: 200, text: page("/assets/main-OLD.js") } } : healthy)(url); };
    const instant = { attempts: 5, wait: 0, sleep: async () => undefined };
    expect(await smoke(base, bundle, slow, instant)).toBeNull();
    expect(await smoke(base, bundle, async () => { throw new Error("offline"); }, instant)).toBe("request failed: offline");
  });
});

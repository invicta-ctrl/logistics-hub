import fs from "node:fs";
import { describe, expect, it } from "vitest";

type Lock = { packages: Record<string, { version?: string; hasInstallScript?: boolean; optional?: boolean }> };

describe("npm install scripts", () => {
  // npm only runs an install script for an exact name@version listed in allowScripts, so a version bump in the lockfile
  // that leaves allowScripts behind silently skips it (wrangler's workerd after the 2026-10-04 bump).
  it("allowScripts names the exact locked version of every required package with an install script", () => {
    const allowed = Object.keys(JSON.parse(fs.readFileSync("package.json", "utf8")).allowScripts ?? {});
    const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8")) as Lock;
    const needed = Object.entries(lock.packages)
      .filter(([path, entry]) => path && entry.hasInstallScript && !entry.optional)
      .map(([path, entry]) => `${path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length)}@${entry.version}`);
    expect(needed.length).toBeGreaterThan(0);
    expect([...new Set(needed)].sort()).toEqual([...allowed].sort());
  });
});

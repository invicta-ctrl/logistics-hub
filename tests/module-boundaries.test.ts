import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { closureOf, importGraph, sourceFiles } from "./source-files";

/*
 * The module boundaries Issue #49 settled for V1.16 (docs/specs/accepted/v1.16-ambient-intelligent-core.md, bounded modularity
 * amendment), read from the source so a later move cannot quietly undo them.
 */

const graph = importGraph();
/** The router's lazy pages (src/main.ts): which module each address loads. */
const ROUTES = [...readFileSync("src/main.ts", "utf8").matchAll(/^\s*"(\/[^"]*)":\s*\(\)\s*=>\s*import\("\.\/([^"]+)"\)/gm)].map(([, path, module]) => ({ path: path!, module: `src/${module}.ts` }));
const staffRoute = (path: string) => path === "/staff" || path.startsWith("/staff/");
const STAFF_PAGES = new Set(ROUTES.filter((route) => staffRoute(route.path)).map((route) => route.module));
/** What a phone or a visitor loads: the main bundle (both pages start at main.ts) and Self-Service, which phones save offline. */
const PUBLIC = ["src/main.ts", ...new Set(ROUTES.filter((route) => !staffRoute(route.path)).map((route) => route.module))];
const reaches = (entry: string) => [...closureOf(graph, entry)];

describe("the import graph this file reads", () => {
  it("sees every page the router loads, and only those, as lazy imports of main.ts", () => {
    expect(ROUTES.length).toBeGreaterThanOrEqual(19);
    expect([...graph.get("src/main.ts")!.lazy].sort()).toEqual([...new Set(ROUTES.map((route) => route.module))].sort());
    expect(PUBLIC).toEqual(["src/main.ts", "src/self-service-app.ts"]);
  });
});

describe("the public bundle (V1.16 MA2)", () => {
  it("the public pages and Self-Service reach no staff, administration or Catalogue module", () => {
    for (const entry of PUBLIC) {
      expect(reaches(entry).filter((file) => STAFF_PAGES.has(file) || /^src\/(staff|admin|catalogue|directory)/.test(file)), entry).toEqual([]);
    }
  });

  it("Self-Service phones no longer download the staff photo editor or any staff API path, only the photo viewer", () => {
    const selfService = reaches("src/self-service-app.ts");
    expect(selfService).toContain("src/item-viewer.ts");
    expect(selfService).not.toContain("src/item-photo.ts");
    for (const entry of PUBLIC) expect(reaches(entry).filter((file) => readFileSync(file, "utf8").includes("/api/staff/")), entry).toEqual([]);
  });
});

describe("the staff shell (V1.16 MA2)", () => {
  it("only the Items page loads the Items screen (staff.ts); sign-in and every other staff page get the shell from staff-shell.ts", () => {
    const loaders = [...graph].filter(([, imports]) => imports.runtime.has("src/staff.ts") || imports.lazy.has("src/staff.ts"))
      .map(([file, imports]) => `${file} ${imports.runtime.has("src/staff.ts") ? "static" : "lazy"}`);
    expect(loaders).toEqual(["src/main.ts lazy"]);
    expect(ROUTES.filter((route) => route.module === "src/staff.ts").map((route) => route.path)).toEqual(["/staff/items"]);
    expect(ROUTES.find((route) => route.path === "/staff")?.module).toBe("src/staff-shell.ts");
    for (const page of STAFF_PAGES) if (page !== "src/staff.ts") expect(reaches(page), page).not.toContain("src/staff.ts");
  });

  it("the shell keeps one copy of its state: the search shortcut and the attention numbers", () => {
    const owners = (pattern: RegExp) => sourceFiles().filter((file) => pattern.test(readFileSync(file, "utf8")));
    expect(owners(/^let searchKey\b/m)).toEqual(["src/staff-shell.ts"]);
    expect(owners(/^let summary\b/m)).toEqual(["src/staff-shell.ts"]);
    expect(owners(/^export const ATTENTION_PAINTED\b/m)).toEqual(["src/staff-shell.ts"]);
  });
});

import { readFileSync } from "node:fs";
import ts from "typescript";
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
    // Every variable the shell keeps between pages, and only the shell.
    const state = [...readFileSync("src/staff-shell.ts", "utf8").matchAll(/^let (\w+)/gm)].map(([, name]) => name!);
    expect(state).toEqual(expect.arrayContaining(["searchKey", "summary", "summaryRequest", "summaryTag"]));
    for (const name of state) expect(owners(new RegExp(`^let ${name}\\b`, "m")), name).toEqual(["src/staff-shell.ts"]);
    expect(owners(/^export const ATTENTION_PAINTED\b/m)).toEqual(["src/staff-shell.ts"]);
  });
});

/** The modules every environment may load: rules and data with no DOM, D1, R2, bindings or secrets (spec, M0 baseline). */
const SHARED = ["ai-review-types", "catalog-draft", "catalog-policy", "catalogue-suggest", "directory-policy", "duplicates", "item-icons", "item-knowledge", "kit-policy", "location-tree", "relation-policy", "search"].map((name) => `src/${name}.ts`);
/** Everything `entry` can load, at once or on demand. */
const everything = (entry: string) => {
  const seen = new Set<string>();
  const visit = (file: string) => { if (seen.has(file)) return; seen.add(file); graph.get(file)!.runtime.forEach(visit); graph.get(file)!.lazy.forEach(visit); };
  visit(entry);
  return seen;
};

describe("environments (V1.16 MA3)", () => {
  it("shared modules import only each other and compile without the browser's, the Worker's or Node's types", () => {
    for (const file of SHARED) {
      const imports = graph.get(file)!;
      expect([...imports.runtime, ...imports.types, ...imports.lazy].filter((target) => !SHARED.includes(target)), file).toEqual([]);
    }
    // Plain ES2022 and nothing else: a shared module that touched the page, D1, R2, a binding or a secret would not compile.
    const program = ts.createProgram(SHARED, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ["lib.es2022.d.ts"], types: [], strict: true, noEmit: true, skipLibCheck: true });
    expect(ts.getPreEmitDiagnostics(program).map((problem) => `${problem.file?.fileName ?? ""}: ${ts.flattenDiagnosticMessageText(problem.messageText, " ")}`)).toEqual([]);
  });

  it("the browser and the Worker load nothing of each other's: what both load is shared", () => {
    const browser = everything("src/main.ts");
    const worker = everything("src/worker.ts");
    expect([...browser].filter((file) => worker.has(file) && !SHARED.includes(file))).toEqual([]);
    expect(worker.has("src/ui.ts") || browser.has("src/inventory.ts")).toBe(false);
  });

  it("the service worker loads exactly its six files", () => {
    expect([...closureOf(graph, "src/sw.ts")].sort()).toEqual(["src/catalog-policy.ts", "src/catalogue-store.ts", "src/offline-queue.ts", "src/offline-store.ts", "src/offline-sync.ts", "src/sw.ts"]);
  });

  it("only worker.ts imports the Staff Directory routes, so its central gate always stands in front of them", () => {
    const importers = [...graph].filter(([, imports]) => [imports.runtime, imports.types, imports.lazy].some((set) => set.has("src/staff-directory-routes.ts"))).map(([file]) => file);
    // Nothing else may import them; that worker.ts serves them is what the Staff Directory API tests show.
    expect(importers.filter((file) => file !== "src/worker.ts")).toEqual([]);
  });
});

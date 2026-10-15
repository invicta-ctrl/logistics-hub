import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";

/** Every file under `dir` whose name ends in one of `extensions`, in subfolders too, as repository paths ("src/ui.ts"), sorted. */
export function sourceFiles(dir = "src", extensions = [".ts"]): string[] {
  return readdirSync(dir, { recursive: true }).map((name) => posix.join(dir, String(name).replaceAll("\\", "/")))
    .filter((file) => extensions.some((extension) => file.endsWith(extension))).sort();
}

/** One module's imports of other source modules, by repository path: erased type-only ones apart from the rest. */
export type Imports = { runtime: Set<string>; types: Set<string>; lazy: Set<string> };

// `import … from "./x"` and `export … from "./x"`. An import clause never holds "=", "(" or ";", so code is never read as one.
const FROM = /^[ \t]*(import|export)[ \t]+(type[ \t]+)?([^;=()]*?)[ \t]+from[ \t]+["'](\.{1,2}\/[^"']+)["']/gm;
const BARE = /^[ \t]*import[ \t]+["'](\.{1,2}\/[^"']+)["']/gm;
const LAZY = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

/**
 * The import graph of the TypeScript under `dir`, read from the source. A type-only import (`import type`, or braces holding only
 * `type` names) is erased by the build and counted apart; any other import counts as runtime, a superset of what the bundler keeps.
 * Imports of styles are left out. A relative import that names no source file fails, so no edge is ever silently missed.
 */
export function importGraph(dir = "src"): Map<string, Imports> {
  const files = sourceFiles(dir);
  const known = new Set(files);
  const graph = new Map<string, Imports>();
  const resolve = (from: string, specifier: string): string | null => {
    if (/\.(css|json)$/.test(specifier)) return null;
    const target = posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\.js$/, ""))) + ".ts";
    if (!known.has(target)) throw new Error(`${from} imports ${specifier}, which is not a source file`);
    return target;
  };
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const imports: Imports = { runtime: new Set(), types: new Set(), lazy: new Set() };
    for (const [, , typeKeyword, clause, specifier] of text.matchAll(FROM)) {
      const target = resolve(file, specifier!);
      if (!target) continue;
      const named = clause!.trim();
      const onlyTypes = Boolean(typeKeyword) || (/^\{[^}]*\}$/.test(named) && named.slice(1, -1).split(",").map((part) => part.trim()).filter(Boolean).every((part) => /^type\s/.test(part)));
      (onlyTypes ? imports.types : imports.runtime).add(target);
    }
    for (const [, specifier] of text.matchAll(BARE)) { const target = resolve(file, specifier!); if (target) imports.runtime.add(target); }
    for (const [, specifier] of text.matchAll(LAZY)) { const target = resolve(file, specifier!); if (target) imports.lazy.add(target); }
    graph.set(file, imports);
  }
  return graph;
}

/** What loading `entry` brings with it before anything is loaded on demand: its runtime imports, followed all the way down. */
export function closureOf(graph: Map<string, Imports>, entry: string, follow: "runtime" | "types" = "runtime"): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    const imports = graph.get(file);
    if (!imports) throw new Error(`${file} is not a source file`);
    seen.add(file);
    imports.runtime.forEach(visit);
    if (follow === "types") imports.types.forEach(visit);
  };
  visit(entry);
  return seen;
}

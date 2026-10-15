import { readFileSync, readdirSync } from "node:fs";
import { posix } from "node:path";
import ts from "typescript";

/** Every file under `dir` whose name ends in one of `extensions`, in subfolders too, as repository paths ("src/ui.ts"), sorted. */
export function sourceFiles(dir = "src", extensions = [".ts"]): string[] {
  return readdirSync(dir, { recursive: true }).map((name) => posix.join(dir, String(name).replaceAll("\\", "/")))
    .filter((file) => extensions.some((extension) => file.endsWith(extension))).sort();
}

/** One module's imports of other source modules, by repository path: erased type-only ones apart from the rest. */
export type Imports = { runtime: Set<string>; types: Set<string>; lazy: Set<string> };

/** An import or export the build erases: `import type`, `export type`, or braces that name only types. */
function erased(node: ts.ImportDeclaration | ts.ExportDeclaration): boolean {
  if (ts.isExportDeclaration(node)) {
    const names = node.exportClause;
    return node.isTypeOnly || (names !== undefined && ts.isNamedExports(names) && names.elements.length > 0 && names.elements.every((name) => name.isTypeOnly));
  }
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true;
  const names = clause.namedBindings;
  return !clause.name && names !== undefined && ts.isNamedImports(names) && names.elements.length > 0 && names.elements.every((name) => name.isTypeOnly);
}

/**
 * The import graph of the TypeScript under `dir`, read with the TypeScript parser, so line breaks, comments and strings cannot hide
 * an import or invent one. A type-only import or export is erased by the build and counted apart; any other counts as runtime, a
 * superset of what the bundler keeps. `import()` counts as loaded on demand, and a type written as `import("./x")` as a type.
 * Imports of styles are left out. A relative import that names no source file fails, and so does an `import()` of anything but a
 * plain string, so no edge is ever silently missed.
 */
export function importGraph(dir = "src"): Map<string, Imports> {
  const files = sourceFiles(dir);
  const known = new Set(files);
  const graph = new Map<string, Imports>();
  const resolve = (from: string, specifier: string): string | null => {
    if (!/^\.{1,2}\//.test(specifier) || /\.(css|json)$/.test(specifier)) return null;
    const target = posix.normalize(posix.join(posix.dirname(from), specifier.replace(/\.js$/, ""))) + ".ts";
    if (!known.has(target)) throw new Error(`${from} imports ${specifier}, which is not a source file`);
    return target;
  };
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
    const imports: Imports = { runtime: new Set(), types: new Set(), lazy: new Set() };
    const visit = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = resolve(file, node.moduleSpecifier.text);
        if (target) (erased(node) ? imports.types : imports.runtime).add(target);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const [specifier] = node.arguments;
        if (!specifier || !ts.isStringLiteralLike(specifier)) throw new Error(`${file} loads a module named by an expression: ${node.getText(source)}`);
        const target = resolve(file, specifier.text);
        if (target) imports.lazy.add(target);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        const target = resolve(file, node.argument.literal.text);
        if (target) imports.types.add(target);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
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

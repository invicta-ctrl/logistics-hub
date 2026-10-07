import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { build, defineConfig, type Plugin, type Rollup } from "vite";

/** The two apps' pages: Self-Service and the staff workspace share index.html; the Catalog has its own, so it installs as itself. */
const PAGES = ["index.html", "staff/catalogue.html"];

/** Files the app needs offline that come from public/ rather than the bundle. */
const PUBLIC_SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/touch-icon.png", "/brand/dol-mark.png", "/brand/hau-usc-crest.webp", "/brand/hau-campus-dusk.webp"];
/** The Catalog app's own page (staff/catalogue.html, served at /staff/catalogue), manifest and icons, saved with the Catalogue's screens. */
const CATALOGUE_SHELL = ["/staff/catalogue", "/catalogue.webmanifest", "/icons/catalog-192.png", "/icons/catalog-512.png", "/icons/catalog-maskable-512.png", "/icons/catalog-touch-icon.png"];

/** Lazy screens every installed device saves to open offline. The other staff tools always need a connection and are not saved. */
const OFFLINE_SCREENS = new Set(["self-service-app"]);
/** The Catalogue's screens: saved only on a device where staff turned offline cataloguing on (sw.ts). */
const CATALOGUE_SCREENS = new Set(["catalogue-workspace"]);

/** The scripts and styles of the chunks `wanted` picks, with everything they import. */
function filesOf(bundle: Rollup.OutputBundle, wanted: (chunk: Rollup.OutputChunk) => boolean): Set<string> {
  const files = new Set<string>();
  const visit = (name: string) => {
    const chunk = bundle[name];
    if (chunk?.type !== "chunk" || files.has(name)) return;
    files.add(name);
    chunk.viteMetadata?.importedCss.forEach((css) => files.add(css));
    chunk.imports.forEach(visit);
  };
  for (const [name, chunk] of Object.entries(bundle)) if (chunk.type === "chunk" && wanted(chunk)) visit(name);
  return files;
}

/**
 * The files of the public pages and the offline screens, then (apart) the Catalogue's own. Only WOFF2 fonts are listed: every
 * browser that runs service workers uses them.
 */
function offlineFiles(bundle: Rollup.OutputBundle): { files: string[]; catalogue: string[] } {
  const files = filesOf(bundle, (chunk) => chunk.isEntry || OFFLINE_SCREENS.has(chunk.name));
  for (const name of Object.keys(bundle)) if (name.endsWith(".woff2")) files.add(name);
  const catalogue = [...filesOf(bundle, (chunk) => CATALOGUE_SCREENS.has(chunk.name))].filter((name) => !files.has(name));
  const paths = (names: Iterable<string>) => [...names].map((name) => `/${name}`).sort();
  return { files: paths(files), catalogue: paths(catalogue) };
}

/**
 * Builds the service worker (src/sw.ts) as one classic script at /sw.js with this build's version
 * and file list baked in. Any change to the app changes sw.js, which is how installed phones learn
 * there is an update.
 */
function serviceWorker(): Plugin {
  return {
    name: "logistics-service-worker",
    apply: "build",
    enforce: "post",
    async generateBundle(_, bundle) {
      const offline = offlineFiles(bundle);
      const files = [...offline.files, ...PUBLIC_SHELL];
      const catalogue = [...offline.catalogue, ...CATALOGUE_SHELL];
      // Every file of the build counts toward the version, so a staff-only change also updates phones.
      const hash = createHash("sha256").update(Object.keys(bundle).sort().join("\n"));
      for (const name of PAGES) { const page = bundle[name]; hash.update(page?.type === "asset" ? String(page.source) : ""); }
      const version = hash.digest("hex").slice(0, 12);
      const output = await build({
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        define: { __BUILD__: JSON.stringify({ version, files, catalogue }) },
        build: { write: false, minify: true, lib: { entry: "src/sw.ts", formats: ["iife"], name: "logisticsServiceWorker", fileName: () => "sw.js" } }
      }) as Rollup.RollupOutput[];
      this.emitFile({ type: "asset", fileName: "sw.js", source: output[0]!.output[0].code });
      // What this build is, for Administration > System (src/system-status.ts). It travels in the assets of the same deploy as the
      // Worker, so it can only describe the code that is answering. The commit is whatever the build environment states: Workers
      // Builds and GitHub Actions both set one; a local build states none and the page says so.
      const commit = [process.env.WORKERS_CI_COMMIT_SHA, process.env.GITHUB_SHA].find((value) => /^[0-9a-f]{40}$/.test(value ?? "")) ?? null;
      const migrations = readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort();
      this.emitFile({ type: "asset", fileName: "build.json", source: JSON.stringify({ version, commit, builtAt: new Date().toISOString(), migrations }) });
    }
  };
}

export default defineConfig({
  build: { sourcemap: true, rollupOptions: { input: PAGES } },
  plugins: [serviceWorker()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true }
});

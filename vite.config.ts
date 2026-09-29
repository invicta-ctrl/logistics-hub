import { createHash } from "node:crypto";
import { build, defineConfig, type Plugin, type Rollup } from "vite";

/** Files the app needs offline that come from public/ rather than the bundle. */
const PUBLIC_SHELL = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/touch-icon.png", "/brand/dol-mark.png", "/brand/hau-usc-crest.webp"];

/**
 * Builds the service worker (src/sw.ts) as one classic script at /sw.js with this build's version
 * and file list baked in. Any change to the app changes sw.js, which is how installed phones learn
 * there is an update. Only WOFF2 fonts are listed: every browser that runs service workers uses them.
 */
function serviceWorker(): Plugin {
  return {
    name: "logistics-service-worker",
    apply: "build",
    enforce: "post",
    async generateBundle(_, bundle) {
      const files = [...Object.keys(bundle).filter((name) => /\.(js|css|woff2)$/.test(name)).map((name) => `/${name}`).sort(), ...PUBLIC_SHELL];
      const page = bundle["index.html"];
      const version = createHash("sha256").update(files.join("\n")).update(page?.type === "asset" ? String(page.source) : "").digest("hex").slice(0, 12);
      const output = await build({
        configFile: false,
        publicDir: false,
        logLevel: "warn",
        define: { __BUILD__: JSON.stringify({ version, files }) },
        build: { write: false, minify: true, lib: { entry: "src/sw.ts", formats: ["iife"], name: "logisticsServiceWorker", fileName: () => "sw.js" } }
      }) as Rollup.RollupOutput[];
      this.emitFile({ type: "asset", fileName: "sw.js", source: output[0]!.output[0].code });
    }
  };
}

export default defineConfig({
  build: { sourcemap: true },
  plugins: [serviceWorker()],
  server: { host: "127.0.0.1", port: 4173, strictPort: true }
});

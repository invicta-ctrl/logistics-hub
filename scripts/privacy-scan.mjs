import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Keys whose values are personal: a name or display name (name_en too), any full_name, or any email. */
export const rosterKey = (key) => /^(display_)?name/i.test(key) || /full_name/i.test(key) || /email$/i.test(key);

function scan() {
  const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
  const prohibited = tracked.filter((file) => file === ".dev.vars" || file.startsWith("data/private/") && file !== "data/private/README.md" || /(^|\/)(\.env|.*\.pem|.*\.key)$/i.test(file));
  if (prohibited.length) {
    console.error(`Prohibited tracked paths: ${prohibited.join(", ")}`);
    process.exit(1);
  }

  const content = (file) => execFileSync("git", ["show", `:${file}`], { encoding: "utf8" });
  const secretPatterns = [
    ["private-key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ["aws-access-key", /AKIA[0-9A-Z]{16}/],
    ["github-token", /gh[pousr]_[A-Za-z0-9_]{20,}/],
    ["literal-secret-assignment", /(?:password|secret|token|api[_-]?key)\s*[:=]\s*["'][A-Za-z0-9_\-]{16,}["']/i]
  ];
  const secretHits = [];
  const trackedContent = new Map(tracked.map((file) => [file, content(file)]));
  for (const [file, text] of trackedContent) {
    for (const [kind, pattern] of secretPatterns) {
      if (pattern.test(text)) secretHits.push({ file, kind });
    }
  }

  const privateDirectory = path.resolve("data/private");
  const rosterValues = new Set();
  const addRosterValues = (value, key = "") => {
    if (typeof value === "string") {
      if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || rosterKey(key)) rosterValues.add(value);
      return;
    }
    if (Array.isArray(value)) value.forEach((entry) => addRosterValues(entry));
    else if (value && typeof value === "object") Object.entries(value).forEach(([entryKey, entryValue]) => addRosterValues(entryValue, entryKey));
  };
  if (fs.existsSync(privateDirectory)) {
    for (const file of fs.readdirSync(privateDirectory)) {
      if (!/\.(json|sql)$/i.test(file)) continue;
      const text = fs.readFileSync(path.join(privateDirectory, file), "utf8");
      for (const email of text.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) rosterValues.add(email[0]);
      if (/\.json$/i.test(file)) {
        try { addRosterValues(JSON.parse(text)); } catch { /* private local input may be non-JSON despite its extension */ }
      }
    }
  }
  const rosterHits = [];
  for (const [file, text] of trackedContent) {
    if ([...rosterValues].some((value) => value.length >= 5 && text.includes(value))) rosterHits.push(file);
  }
  if (secretHits.length || rosterHits.length) {
    if (secretHits.length) console.error(`Secret-pattern content matches (path and category only): ${secretHits.map(({ file, kind }) => `${file} [${kind}]`).join(", ")}`);
    if (rosterHits.length) console.error(`Private roster identity/email content matches (paths only): ${rosterHits.join(", ")}`);
    process.exit(1);
  }
  console.log(`privacy-scan: path checks passed; staged tracked-content secret matches: 0; private roster identity/email matches: 0; files scanned: ${tracked.length}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) scan();

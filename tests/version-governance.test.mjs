import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProductChange, nextVersionAllowed, checkVersionChange, parseProductVersion, validNotes,
} from "../scripts/verify-product-version.mjs";

const previous = {
  version: "V1.16",
  sourceCommit: "9".repeat(40),
  record: "docs/road-to-v2/releases/v1.16.md",
  changes: ["Previous accepted release", "Previous shipped improvements"],
};
const candidate = {
  version: "V1.16.1",
  sourceCommit: "a".repeat(40),
  record: "docs/road-to-v2/releases/v1.16.1.md",
  changes: ["Corrected a released feature", "Kept its fallback working"],
};
const validPaths = ["src/worker.ts", "product-release.json", candidate.record];
const check = (paths = validPaths, after = candidate) => checkVersionChange({
  paths, before: previous, after, recordExists: (p) => p === candidate.record,
});

describe("product version gate (V1.16 and Road to V3)", () => {
  it("classifies app/runtime/config edits but not documentation and CI-only changes", () => {
    for (const path of ["docs/README.md", "tests/catalogue.test.ts", ".github/workflows/ci.yml",
      "AGENTS.md", ".codex/CURRENT.md", "scripts/verify-product-version.mjs"]) {
      assert.equal(isProductChange(path), false, path);
    }
    for (const path of ["src/worker.ts", "src/styles.css", "public/logo.svg",
      "wrangler.jsonc", "package-lock.json", "migrations/0031_test.sql",
      "product-release.json", "scripts/ops/production-release.mjs", "../src/worker.ts"]) {
      assert.equal(isProductChange(path), true, path);
    }
  });

  it("recognizes only strict product version forms", () => {
    assert.deepEqual(parseProductVersion("V1.16.1"), { major: 1, minor: 16, patch: 1 });
    for (const bad of ["V1.15.0", "V1.16.01", "v1.16", "V1.16.1.1", "V02.1",
      "V1.16x", "V1.16.999999999999999999"]) {
      assert.equal(parseProductVersion(bad), null, bad);
    }
  });

  it("supports V1.16 patches and accepted next-release milestones", () => {
    for (const [before, after] of [["V1.16", "V1.16.1"], ["V1.16.1", "V1.16.2"],
      ["V1.15.4", "V1.16"], ["V1.16", "V2.1"], ["V1.16.3", "V2.1"],
      ["V2.1", "V2.2"], ["V2.9", "V3.0"], ["V2.9.1", "V3.0"]]) {
      assert.equal(nextVersionAllowed(before, after), true, before + " -> " + after);
    }
    for (const [before, after] of [["V1.16", "V1.16"], ["V1.16", "V1.16.2"],
      ["V1.16", "V2.0"], ["V1.16", "V3.0"], ["V2.7", "V2.9"],
      ["V2.9", "V3.1"], ["V2.1", "V1.16.1"]]) {
      assert.equal(nextVersionAllowed(before, after), false, before + " -> " + after);
    }
  });

  it("rejects incomplete or dishonest release metadata", () => {
    assert.deepEqual(check().failures, []);
    assert.match(check(["src/worker.ts", candidate.record]).failures.join(" "), /product-release.json/);
    assert.match(check(validPaths, { ...candidate, version: "V1.16" }).failures.join(" "), /advance/);
    assert.match(check(validPaths, { ...candidate, sourceCommit: previous.sourceCommit }).failures.join(" "), /sourceCommit/);
    assert.match(check(validPaths, { ...candidate, changes: previous.changes }).failures.join(" "), /repeat/);
    assert.match(check(validPaths, { ...candidate, record: previous.record }).failures.join(" "), /record/);
    assert.match(check(["src/worker.ts", "product-release.json"]).failures.join(" "), /record/);
  });

  it("enforces the same note limits and plain-text safety as System", () => {
    assert.equal(validNotes(candidate.changes), true);
    for (const notes of [
      ["One note"], ["x".repeat(181), "Other note"], [" Not trimmed", "Other note"],
      ["<script>", "Other note"], ["Line\nbreak", "Other note"], ["Ok", "  "],
      ["a", "Other note"], ["ok", "fine", "yes", "pass", "five", "six"],
    ]) {
      assert.equal(validNotes(notes), false, JSON.stringify(notes));
    }
    assert.match(check(validPaths, { ...candidate, changes: ["<script>", "Other note"] }).failures.join(" "), /plain notes/);
  });

  it("does not mint versions for pure governance, docs, tests, or CI edits", () => {
    assert.deepEqual(checkVersionChange({
      paths: ["docs/PRODUCT_VERSION_GOVERNANCE.md", "tests/version-governance.test.mjs",
        ".github/workflows/ci.yml", "scripts/verify-product-version.mjs", "AGENTS.md"],
      before: previous, after: previous,
    }), { impacting: [], failures: [] });
  });
});

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isProductChange, nextVersionAllowed, checkVersionChange, parseProductVersion } from "../scripts/verify-product-version.mjs";

const previous = {
  version: "V1.15",
  sourceCommit: "9".repeat(40),
  record: "docs/road-to-v2/releases/v1.15-final-pass.md",
  changes: ["Original release", "Legacy features"],
};
const candidate = {
  version: "V1.15.1",
  sourceCommit: "a".repeat(40),
  record: "docs/road-to-v2/releases/v1.15.1.md",
  changes: ["Verified improvement", "Safe user-facing behavior"],
};
const accepted = (record) => record === candidate.record;
const check = (paths, current = candidate) => checkVersionChange({
  paths, before: previous, after: current, recordExists: accepted,
});

describe("product version release gate", () => {
  it("separates app changes from documentation, policy and regression tests", () => {
    for (const name of ["docs/README.md", "tests/catalogue.test.ts", ".github/workflows/ci.yml",
      "AGENTS.md", ".codex/SESSION_HANDOFF.md", "scripts/verify-product-version.mjs"]) {
      assert.equal(isProductChange(name), false, name);
    }
    for (const name of ["src/worker.ts", "src/styles.css", "public/logo.svg", "wrangler.jsonc",
      "package-lock.json", "migrations/0031_test.sql", "product-release.json", "scripts/ops/production-release.mjs"]) {
      assert.equal(isProductChange(name), true, name);
    }
  });

  it("refuses a code change that forgot its version manifest", () => {
    assert.match(check(["src/styles.css"]).failures.join(" "), /product-release\.json/);
  });

  it("refuses silent version reuse in a V1.16 implementation checkpoint", () => {
    const x = check(["src/worker.ts", "product-release.json"], { ...candidate, version: "V1.15" });
    assert.match(x.failures.join(" "), /exactly one revision/);
  });

  it("accepts one correctly recorded revision and a separate documented release identity", () => {
    assert.deepEqual(check(["src/catalogue-capture.ts", "product-release.json", candidate.record]).failures, []);
    assert.equal(nextVersionAllowed("V1.15.1", "V1.15.2"), true);
    assert.equal(nextVersionAllowed("V1.15.4", "V1.16"), true);
    assert.equal(nextVersionAllowed("V1.16", "V2.1"), true);
  });

  it("rejects skipped, reused and invented version numbers", () => {
    for (const v of ["V1.15", "V1.15.0", "V1.15.2", "V1.17", "V3.0", "v1.15.1"]) {
      assert.equal(nextVersionAllowed("V1.15", v), false, v);
    }
    assert.equal(parseProductVersion("V1.15.01"), null);
  });

  it("requires new provenance, fresh notes and a revision-specific release record", () => {
    assert.match(check(["src/main.ts", "product-release.json"], {
      ...candidate, sourceCommit: previous.sourceCommit,
    }).failures.join(" "), /sourceCommit/);
    assert.match(check(["src/main.ts", "product-release.json"], {
      ...candidate, record: "docs/missing.md",
    }).failures.join(" "), /release record/);
    assert.match(check(["src/main.ts", "product-release.json"], {
      ...candidate, changes: ["One line only"],
    }).failures.join(" "), /2–5/);
    assert.match(check(["src/main.ts", "product-release.json", candidate.record], {
      ...candidate, changes: previous.changes,
    }).failures.join(" "), /What.s new/);
    assert.match(check(["src/main.ts", "product-release.json", candidate.record], {
      ...candidate, record: previous.record,
    }).failures.join(" "), /parent record/);
    assert.match(check(["src/main.ts", "product-release.json"], candidate).failures.join(" "), /same change/);
  });

  it("lets pure documentation and isolated policy corrections pass without minting a version", () => {
    assert.deepEqual(checkVersionChange({
      paths: ["docs/PRODUCT_VERSION_GOVERNANCE.md", ".github/workflows/ci.yml",
        "tests/version-governance.test.mjs", "scripts/verify-product-version.mjs"],
      before: previous, after: previous,
    }), { impacting: [], failures: [] });
  });

  it("fails closed for unknown paths and path traversal", () => {
    assert.equal(isProductChange("scripts/new-feature.mjs"), true);
    assert.equal(isProductChange("../src/worker.ts"), true);
  });
});

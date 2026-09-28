import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeEphemeralDevVars } from "../scripts/run-worker-browser-tests.mjs";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe("worker browser test credentials", () => {
  it("refuses to replace an operator .dev.vars file and preserves its contents", () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "logistics-hub-test-"));
    directories.push(directory);
    const devVars = path.join(directory, ".dev.vars");
    const operatorContents = "operator-managed-credentials\n";
    fs.writeFileSync(devVars, operatorContents, "utf8");

    expect(() => writeEphemeralDevVars(devVars, "ephemeral-test-credentials\n")).toThrow();
    expect(fs.readFileSync(devVars, "utf8")).toBe(operatorContents);
  });
});

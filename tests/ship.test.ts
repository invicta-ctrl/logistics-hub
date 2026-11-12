import { describe, expect, it } from "vitest";
import { shipDecision } from "../scripts/ops/ship.mjs";

const sha = "a".repeat(40);
const required = [{ context: "CodeQL", app_id: 57789 }, { context: "checks", app_id: 15368 }, { context: "worker-e2e", app_id: 15368 }];
const passed = (name: string, app: number, id = 1, extra = {}) => ({ id, name, head_sha: sha, status: "completed", conclusion: "success", app: { id: app }, ...extra });
const green = [passed("CodeQL", 57789), passed("checks", 15368), passed("worker-e2e", 15368)];
const pr = { state: "OPEN", isDraft: false, baseRefName: "main", headRefOid: sha };

describe("ship: fast-forwarding main to a checked PR head (LH-CD-01)", () => {
  it("ships an open, up-to-date PR whose every required check passed on its exact head", () => {
    expect(shipDecision({ pr, required, checks: green, upToDate: true })).toEqual({ ship: true, sha, reasons: [] });
  });

  it("refuses a head that is not based on the current main, so main never moves except by fast-forward", () => {
    expect(shipDecision({ pr, required, checks: green, upToDate: false }).ship).toBe(false);
  });

  it("refuses a missing, unfinished or failed required check, and judges only the latest run of each", () => {
    expect(shipDecision({ pr, required, checks: green.slice(1), upToDate: true }).reasons).toEqual(["CodeQL has not run on aaaaaaa"]);
    const pending = [...green.slice(0, 2), passed("worker-e2e", 15368, 1, { status: "in_progress", conclusion: null })];
    expect(shipDecision({ pr, required, checks: pending, upToDate: true }).reasons).toEqual(["worker-e2e is still in_progress"]);
    // A rerun that failed after an earlier success blocks; a rerun that passed after a failure ships.
    const failedRerun = [...green, passed("checks", 15368, 2, { conclusion: "failure" })];
    expect(shipDecision({ pr, required, checks: failedRerun, upToDate: true }).reasons).toEqual(["checks ended failure"]);
    const passedRerun = [...green.filter((run) => run.name !== "checks"), passed("checks", 15368, 1, { conclusion: "failure" }), passed("checks", 15368, 2)];
    expect(shipDecision({ pr, required, checks: passedRerun, upToDate: true }).ship).toBe(true);
  });

  it("ignores a same-named check from another app, or on another commit", () => {
    const impostors = [passed("CodeQL", 99999), passed("checks", 15368), passed("worker-e2e", 15368), passed("CodeQL", 57789, 3, { head_sha: "b".repeat(40) })];
    expect(shipDecision({ pr, required, checks: impostors, upToDate: true }).reasons).toEqual(["CodeQL has not run on aaaaaaa"]);
  });

  it("refuses a closed, draft or non-main PR, and unreadable protection rules", () => {
    expect(shipDecision({ pr: { ...pr, state: "MERGED" }, required, checks: green, upToDate: true }).ship).toBe(false);
    expect(shipDecision({ pr: { ...pr, isDraft: true }, required, checks: green, upToDate: true }).ship).toBe(false);
    expect(shipDecision({ pr: { ...pr, baseRefName: "dev" }, required, checks: green, upToDate: true }).ship).toBe(false);
    expect(shipDecision({ pr, required: [], checks: green, upToDate: true }).reasons).toContain("main's required checks could not be read");
  });
});

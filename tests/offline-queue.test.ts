import { describe, expect, it } from "vitest";
import { type LocalEvent, type Snapshot, applyResults, backoff, estimate, forgettable, nextBatch, openLoans, RETENTION_MS, retryAll, toWire } from "../src/offline-queue";

const NOW = Date.parse("2026-09-30T02:00:00Z");
let seq = 0;
function local(type: LocalEvent["type"], fields: Partial<LocalEvent> = {}): LocalEvent {
  seq += 1;
  return {
    v: 1, id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, seq, type, itemId: "ITM-0001", quantity: 1, occurredAt: new Date(NOW).toISOString(),
    catalogRevision: 7, person: { name: "Ana" }, state: "pending", attempts: 0, nextAttemptAt: 0, hasPhoto: type === "BORROW", itemName: "Scissors", unit: "piece", ...fields
  };
}
const snapshot = (available: number, revision = 7): Snapshot => ({
  revision, fetchedAt: NOW, checkedAt: NOW,
  items: [{ id: "ITM-0001", name: "Scissors", aliases: null, category: "SUPPLIES", unit: "piece", action: "BORROW", available, location: null, audience: "STUDENTS_AND_USC_STAFF" }]
});

describe("the phone's queue", () => {
  it("sends only the wire fields, never local bookkeeping", () => {
    const event = local("TAKE", { message: "x", attempts: 3 });
    expect(Object.keys(toWire(event)).sort()).toEqual(["catalogRevision", "id", "itemId", "occurredAt", "person", "quantity", "seq", "type", "v"]);
  });

  it("batches in the phone's own order, at most five records and four photos, and never skips ahead of a backing-off record", () => {
    const borrows = Array.from({ length: 5 }, () => local("BORROW"));
    expect(nextBatch(borrows, NOW).map((event) => event.seq)).toEqual(borrows.slice(0, 4).map((event) => event.seq));
    const takes = Array.from({ length: 7 }, () => local("TAKE"));
    expect(nextBatch(takes, NOW)).toHaveLength(5);
    const waiting = [{ ...takes[0]!, nextAttemptAt: NOW + 10_000 }, ...takes.slice(1)];
    expect(nextBatch(waiting, NOW)).toEqual([]);
    expect(nextBatch(waiting, NOW, true)).toHaveLength(5);
  });

  it("keeps a record until the server answers, and backs off on retry", () => {
    const [take, borrow] = [local("TAKE"), local("BORROW")];
    const retried = applyResults([take, borrow], [{ id: take.id, outcome: "accepted" }, { id: borrow.id, outcome: "retry" }], 9, NOW);
    expect(retried[0]).toMatchObject({ state: "synced", appliedRevision: 9 });
    expect(retried[1]).toMatchObject({ state: "pending", attempts: 1, nextAttemptAt: NOW + backoff(1) });
    const offline = retryAll(retried, new Set([borrow.id]), NOW);
    expect(offline[1]).toMatchObject({ state: "pending", attempts: 2 });
    expect(backoff(20)).toBe(15 * 60_000);
  });

  it("drops a return whose borrow was not recorded, instead of sending it", () => {
    const borrow = local("BORROW");
    const giveBack = local("RETURN", { loanEventId: borrow.id, outcome: "RETURNED" });
    const after = applyResults([borrow, giveBack], [{ id: borrow.id, outcome: "rejected", message: "A photo is required." }], 9, NOW);
    expect(after.map((event) => event.state)).toEqual(["rejected", "rejected"]);
  });

  it("estimates availability from the snapshot and this phone's records the snapshot does not include yet", () => {
    const borrow = local("BORROW");
    expect(estimate(snapshot(5), [borrow]).get("ITM-0001")).toBe(4);
    const synced = { ...borrow, state: "synced" as const, appliedRevision: 8 };
    expect(estimate(snapshot(5, 7), [synced]).get("ITM-0001")).toBe(4);
    expect(estimate(snapshot(4, 8), [synced]).get("ITM-0001")).toBe(4);
    const giveBack = local("RETURN", { loanEventId: borrow.id, outcome: "RETURNED" });
    expect(estimate(snapshot(4, 8), [synced, giveBack]).get("ITM-0001")).toBe(5);
    expect(estimate(snapshot(0), [local("TAKE", { quantity: 3 })]).get("ITM-0001")).toBe(0);
    // A use of an open unit changes no stock, pending or not.
    expect(estimate(snapshot(5), [local("USE"), local("USE")]).get("ITM-0001")).toBe(5);
  });

  it("tracks open loans and never forgets pending records or open loans", () => {
    const [open, closed] = [local("BORROW", { state: "synced", settledAt: NOW - RETENTION_MS - 1 }), local("BORROW", { state: "synced", settledAt: NOW - RETENTION_MS - 1 })];
    const giveBack = local("RETURN", { loanEventId: closed.id, outcome: "DAMAGED", state: "synced", settledAt: NOW - RETENTION_MS - 1 });
    const pending = local("TAKE");
    const events = [open, closed, giveBack, pending];
    expect(openLoans(events).map((event) => event.id)).toEqual([open.id]);
    expect(forgettable(events, NOW)).toEqual([closed.id, giveBack.id]);
    expect(forgettable(events, NOW - RETENTION_MS)).toEqual([]);
    expect(forgettable(events, NOW - RETENTION_MS, true)).toEqual([closed.id, giveBack.id]);
  });
});

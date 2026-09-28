import { describe, expect, it } from "vitest";
import { createSession, verifySession } from "../src/session";

describe("staff session signing", () => {
  it("accepts a signed unexpired session", async () => {
    const signed = await createSession({ id: "session-1", subject: "test", role: "STAFF", exp: Date.now() + 60_000 }, "test-secret");
    await expect(verifySession(signed, "test-secret")).resolves.toMatchObject({ subject: "test", role: "STAFF" });
  });

  it("rejects tampered or expired sessions", async () => {
    const signed = await createSession({ id: "session-1", subject: "test", role: "STAFF", exp: Date.now() - 1 }, "test-secret");
    await expect(verifySession(signed, "test-secret")).resolves.toBeNull();
    await expect(verifySession("tampered.session", "test-secret")).resolves.toBeNull();
  });
});

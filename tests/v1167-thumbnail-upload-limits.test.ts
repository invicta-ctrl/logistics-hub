import { describe, expect, it } from "vitest";
import { saveLoanThumb } from "../src/loans";
import { memoryR2 } from "./d1-sqlite";

const PHOTO_KEY = "loans/LN-TEST";
const db = {
  prepare: () => ({ bind: () => ({ first: async () => PHOTO_KEY }) })
} as unknown as D1Database;

function jpeg(size: number) {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff]);
  return bytes;
}

function streamingRequest(chunks: Uint8Array[], contentLength?: string) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; }
  }, { highWaterMark: 0 });
  const headers: Record<string, string> = { "content-type": "image/jpeg" };
  if (contentLength !== undefined) headers["content-length"] = contentLength;
  const request = new Request("https://hub.test/thumb", { method: "PUT", headers, body, duplex: "half" } as RequestInit);
  return { request, pulls: () => pulls, cancelled: () => cancelled };
}

describe("thumbnail request stream limits", () => {
  it.each([["absent", undefined], ["understated", "1"]])("stops reading an oversized stream with %s Content-Length", async (_label, contentLength) => {
    const { bucket, objects } = memoryR2();
    const streamed = streamingRequest([jpeg(30_000), new Uint8Array(20_000), new Uint8Array(1)], contentLength);
    await expect(saveLoanThumb(db, bucket, "LN-TEST", streamed.request)).rejects.toMatchObject({ status: 413 });
    expect(streamed.pulls()).toBe(2);
    expect(streamed.cancelled()).toBe(true);
    expect(objects.has(`${PHOTO_KEY}.thumb`)).toBe(false);
  });

  it("accepts an exact-limit JPEG split across stream chunks", async () => {
    const { bucket, objects } = memoryR2();
    const bytes = jpeg(48_000);
    const streamed = streamingRequest([bytes.subarray(0, 2), bytes.subarray(2, 24_000), bytes.subarray(24_000)]);
    expect((await saveLoanThumb(db, bucket, "LN-TEST", streamed.request)).status).toBe(204);
    expect(objects.get(`${PHOTO_KEY}.thumb`)?.bytes).toEqual(bytes);
  });

  it("rejects an advertised oversize before reading", async () => {
    const { bucket } = memoryR2();
    const streamed = streamingRequest([jpeg(4)], "48001");
    await expect(saveLoanThumb(db, bucket, "LN-TEST", streamed.request)).rejects.toMatchObject({ status: 413 });
    expect(streamed.pulls()).toBe(0);
  });

  it("keeps the invalid-JPEG response for an empty body", async () => {
    const { bucket } = memoryR2();
    const request = new Request("https://hub.test/thumb", { method: "PUT", headers: { "content-type": "image/jpeg" } });
    await expect(saveLoanThumb(db, bucket, "LN-TEST", request)).rejects.toMatchObject({ status: 415 });
  });
});

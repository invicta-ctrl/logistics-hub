import fs from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Minimal D1 stand-in over node:sqlite with every real migration applied. */
export function migratedD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  // Like remote D1: foreign keys are enforced and each migration applies atomically.
  sqlite.exec("PRAGMA foreign_keys = ON");
  for (const file of fs.readdirSync("migrations").sort()) {
    sqlite.exec("BEGIN");
    sqlite.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
    sqlite.exec("COMMIT");
  }
  const statement = (sql: string, args: SQLInputValue[] = []) => {
    const execute = () => {
      const prepared = sqlite.prepare(sql);
      if (/^\s*(SELECT|WITH)\b|\bRETURNING\b/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } };
      return { results: [], meta: { changes: Number(prepared.run(...args).changes) } };
    };
    return {
      execute,
      bind: (...next: SQLInputValue[]) => statement(sql, next),
      all: async () => execute(),
      run: async () => execute(),
      first: async (column?: string) => {
        const row = sqlite.prepare(sql).get(...args) as Record<string, unknown> | undefined;
        return row ? (column ? row[column] : row) : null;
      }
    };
  };
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((entry) => entry.execute());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    }
  };
  return { d1: d1 as unknown as D1Database, sqlite };
}

/** Minimal R2 stand-in: atomic create-if-absent is evaluated when PUT commits, as on R2. */
export function memoryR2(): { bucket: R2Bucket; objects: Map<string, { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string; customMetadata?: Record<string, string> }>();
  const bucket = {
    put: async (key: string, bytes: Uint8Array, options?: { onlyIf?: Headers; httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }) => {
      if (options?.onlyIf?.get("If-None-Match") === "*" && objects.has(key)) return null;
      objects.set(key, { bytes, contentType: options?.httpMetadata?.contentType, customMetadata: options?.customMetadata });
      return { key, size: bytes.byteLength };
    },
    get: async (key: string) => {
      const object = objects.get(key);
      return object ? { body: new Blob([object.bytes as BlobPart]).stream(), httpMetadata: { contentType: object.contentType }, customMetadata: object.customMetadata, size: object.bytes.byteLength } : null;
    },
    head: async (key: string) => { const object = objects.get(key); return object ? { key, size: object.bytes.length, httpMetadata: { contentType: object.contentType }, customMetadata: object.customMetadata } : null; },
    delete: async (key: string) => { objects.delete(key); },
    list: async (options?: { prefix?: string }) => ({ objects: [...objects.keys()].filter((key) => key.startsWith(options?.prefix ?? "")).map((key) => ({ key })), truncated: false })
  };
  return { bucket: bucket as unknown as R2Bucket, objects };
}

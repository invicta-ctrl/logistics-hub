import fs from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

/** Minimal D1 stand-in over node:sqlite with every real migration applied. */
export function migratedD1(): { d1: D1Database; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of fs.readdirSync("migrations").sort()) sqlite.exec(fs.readFileSync(`migrations/${file}`, "utf8"));
  const statement = (sql: string, args: SQLInputValue[] = []) => {
    const execute = () => {
      const prepared = sqlite.prepare(sql);
      if (/^\s*SELECT/i.test(sql)) return { results: prepared.all(...args), meta: { changes: 0 } };
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

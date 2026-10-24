/*
 * What one staff request cost (V1.16.4 §4.8.6): the D1 and R2 work it waited for, measured by wrapping the two bindings for that
 * request only. A call is one sequential wait: operations started while another of the same binding is still running (one
 * Promise.all, one batch) count once, so the figure is the round trips a person waits through. Time is the span with at least one
 * operation in flight. Nothing about the request's content is kept: no identity, no query text, no values.
 */

type Meter = { calls: number; ms: number; running: number; since: number };
export type Cost = { d1: Meter; r2: Meter; started: number };

const meter = (): Meter => ({ calls: 0, ms: 0, running: 0, since: 0 });
export const startCost = (): Cost => ({ d1: meter(), r2: meter(), started: Date.now() });

function timed<T>(state: Meter, work: () => Promise<T>): Promise<T> {
  if (state.running++ === 0) { state.calls += 1; state.since = Date.now(); }
  const settle = () => { if (--state.running === 0) state.ms += Date.now() - state.since; };
  let started: Promise<T>;
  try { started = work(); } catch (error) { settle(); return Promise.reject(error); }
  return started.then((value) => { settle(); return value; }, (error: unknown) => { settle(); throw error; });
}

const UNWRAPPED = new WeakMap<object, D1PreparedStatement>();
type Callable = (...args: unknown[]) => unknown;
const call = (target: object, name: string, args: unknown[]) => (target[name as keyof typeof target] as unknown as Callable).apply(target, args);

function measuredStatement(real: D1PreparedStatement, state: Meter): D1PreparedStatement {
  const wrapped = {
    bind: (...values: unknown[]) => measuredStatement(call(real, "bind", values) as D1PreparedStatement, state),
    first: (...args: unknown[]) => timed(state, () => call(real, "first", args) as Promise<unknown>),
    all: (...args: unknown[]) => timed(state, () => call(real, "all", args) as Promise<unknown>),
    run: (...args: unknown[]) => timed(state, () => call(real, "run", args) as Promise<unknown>),
    raw: (...args: unknown[]) => timed(state, () => call(real, "raw", args) as Promise<unknown>)
  };
  UNWRAPPED.set(wrapped, real);
  return wrapped as unknown as D1PreparedStatement;
}

/** The request's own view of D1: every statement and batch it awaits is counted and timed. */
export function measuredD1(db: D1Database, cost: Cost): D1Database {
  return {
    prepare: (sql: string) => measuredStatement(db.prepare(sql), cost.d1),
    batch: (statements: D1PreparedStatement[]) => timed(cost.d1, () => db.batch(statements.map((statement) => UNWRAPPED.get(statement) ?? statement))),
    exec: (sql: string) => timed(cost.d1, () => db.exec(sql)),
    dump: () => timed(cost.d1, () => db.dump()),
    withSession: (...args: unknown[]) => call(db, "withSession", args)
  } as unknown as D1Database;
}

/** The request's own view of an R2 bucket: reads, writes, deletes and listings are counted and timed. */
export function measuredR2(bucket: R2Bucket, cost: Cost): R2Bucket {
  const timedCall = (name: string) => (...args: unknown[]) => timed(cost.r2, () => call(bucket, name, args) as Promise<unknown>);
  return {
    head: timedCall("head"), get: timedCall("get"), put: timedCall("put"), delete: timedCall("delete"), list: timedCall("list"),
    createMultipartUpload: timedCall("createMultipartUpload"), resumeMultipartUpload: (...args: unknown[]) => call(bucket, "resumeMultipartUpload", args)
  } as unknown as R2Bucket;
}

/** `Server-Timing` for the browser's network panel: D1 and R2 time with their call counts, and the whole request. */
export function serverTiming(cost: Cost): string {
  return `d1;dur=${cost.d1.ms};desc="${cost.d1.calls} calls", r2;dur=${cost.r2.ms};desc="${cost.r2.calls} calls", total;dur=${Date.now() - cost.started}`;
}

/**
 * The one structured line per answered staff request worth recording: every write, and every read that sent a body (a 304 is
 * the cheap path working and is left out, so the volume stays within the Workers Logs allowance). Route, never the address.
 */
export function costLine(route: string, method: string, status: number, bytes: number | null, cost: Cost): Record<string, unknown> | null {
  if (method === "GET" && status === 304) return null;
  return { event: "staff_request", route, method, status, ms: Date.now() - cost.started, d1Calls: cost.d1.calls, d1Ms: cost.d1.ms, r2Calls: cost.r2.calls, r2Ms: cost.r2.ms, bytes };
}

/** A JSON answer, never stored by a cache unless the caller says otherwise. One helper for worker.ts and the route modules it calls. */
export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
}

/** A JSON answer, never stored by a cache unless the caller says otherwise. One helper for worker.ts and the route modules it calls. */
/** How many bytes each JSON answer carries, for the request's cost line (measure.ts). Read before anything copies the response. */
export const sizes = new WeakMap<Response, number>();

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const response = new Response(bytes, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
  sizes.set(response, bytes.byteLength);
  return response;
}

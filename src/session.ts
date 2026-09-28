export type StaffSession = { id: string; subject: string; role: string; exp: number };

const encoder = new TextEncoder();
// Cloudflare Workers cap PBKDF2 at 100k iterations; scripts/staff-account.mjs must match.
export const PASSWORD_ITERATIONS = 100_000;

function toBase64(value: Uint8Array | string): string {
  const binary = typeof value === "string" ? value : String.fromCharCode(...value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hmacKey(secret: string, usage: KeyUsage): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function createSession(session: StaffSession, secret: string): Promise<string> {
  const payload = toBase64(JSON.stringify(session));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(payload)));
  return `${payload}.${toBase64(signature)}`;
}

export async function verifySession(value: string | undefined, secret: string | undefined): Promise<StaffSession | null> {
  if (!value || !secret) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  try {
    // HMAC verify is constant-time, unlike comparing signature strings.
    if (!await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), fromBase64(signature), encoder.encode(payload))) return null;
    const session = JSON.parse(new TextDecoder().decode(fromBase64(payload))) as StaffSession;
    return typeof session.id === "string" && typeof session.subject === "string" && typeof session.role === "string" && Number.isFinite(session.exp) && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** Format: pbkdf2-sha256$<iterations>$<salt>$<hash>, base64url parts. */
export async function hashPassword(password: string, salt = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(await derive(password, salt, PASSWORD_ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iterationText, salt, expected] = stored.split("$");
  const iterations = Number(iterationText);
  if (scheme !== "pbkdf2-sha256" || !Number.isInteger(iterations) || iterations < 1 || iterations > PASSWORD_ITERATIONS || !salt || !expected) return false;
  const actual = await derive(password, fromBase64(salt), iterations);
  const wanted = fromBase64(expected);
  let difference = actual.length ^ wanted.length;
  for (let index = 0; index < actual.length; index += 1) difference |= actual[index] ^ (wanted[index] ?? 0);
  return difference === 0;
}

export function readCookie(request: Request, name: string): string | undefined {
  const entry = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

export type StaffSession = { id: string; subject: string; role: string; exp: number };

const encoder = new TextEncoder();

function toBase64(value: Uint8Array | string): string {
  const binary = typeof value === "string" ? value : String.fromCharCode(...value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function createSession(session: StaffSession, secret: string): Promise<string> {
  const payload = toBase64(JSON.stringify(session));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySession(value: string | undefined, secret: string | undefined): Promise<StaffSession | null> {
  if (!value || !secret) return null;
  const [payload, signature] = value.split(".");
  if (!payload || !signature || signature !== await sign(payload, secret)) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(fromBase64(payload))) as StaffSession;
    return typeof session.id === "string" && typeof session.subject === "string" && typeof session.role === "string" && Number.isFinite(session.exp) && session.exp > Date.now() ? session : null;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | undefined {
  const entry = request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry?.slice(name.length + 1);
}

// Signed session cookie, built on Web Crypto so it works in both the proxy and route handlers.
// Token format: <profileId>.<sessionVersion>.<expiry>.<signature>
// Bumping a profile's session_version (e.g. when its PIN changes) signs out all its devices.

export const SESSION_COOKIE = "cv_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmacKey() {
  // SESSION_SECRET is optional: the Supabase server key (added automatically by the
  // Vercel ↔ Supabase integration) is already a long, private random string.
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set");
  return crypto.subtle.importKey("raw", enc.encode(`card-vault-session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function toB64Url(buf: ArrayBuffer) {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64Url(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export async function createSessionToken(profileId: string, version: number) {
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  const payload = `${profileId}.${version}.${exp}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(payload));
  return `${payload}.${toB64Url(sig)}`;
}

export type SessionClaims = { profileId: string; version: number };

/** Checks the signature and expiry only. Route handlers also check the version against the database. */
export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [profileId, version, exp, sig] = parts;
  if (!/^[0-9a-f-]{36}$/i.test(profileId) || !/^\d+$/.test(version) || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(), fromB64Url(sig), enc.encode(`${profileId}.${version}.${exp}`));
    return ok ? { profileId, version: Number(version) } : null;
  } catch {
    return null;
  }
}

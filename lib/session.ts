// Signed session cookie, built on Web Crypto so it works in both the proxy and route handlers.
// The signing key mixes in the PIN, so changing APP_PIN logs every device out.

export const SESSION_COOKIE = "cv_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

async function hmacKey() {
  // SESSION_SECRET is optional: the Supabase server key (added automatically by the
  // Vercel ↔ Supabase integration) is already a long, private random string.
  const secret = process.env.SESSION_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const pin = process.env.APP_PIN;
  if (!secret || !pin) throw new Error("APP_PIN must be set (and Supabase connected)");
  return crypto.subtle.importKey("raw", enc.encode(`${secret}:${pin}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
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

export async function createSessionToken() {
  const exp = String(Date.now() + SESSION_DAYS * 86_400_000);
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(exp));
  return `${exp}.${toB64Url(sig)}`;
}

export async function verifySessionToken(token: string | undefined | null) {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  try {
    return await crypto.subtle.verify("HMAC", await hmacKey(), fromB64Url(sig), enc.encode(exp));
  } catch {
    return false;
  }
}

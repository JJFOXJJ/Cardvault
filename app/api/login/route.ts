import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/supabase";
import { jsonError, setSessionCookie } from "@/lib/auth";
import { checkPin, hashPin, isValidPin, PIN_RULE } from "@/lib/pin";
import { SESSION_COOKIE } from "@/lib/session";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

const missingProfilesTable = (msg?: string) => !!msg && /profiles|relation|schema cache|profile_id/i.test(msg);

/** Public: what the sign-in screen needs — first-time setup, or the list of profile names. */
export async function GET() {
  const { data, error } = await db().from("profiles").select("id, name").order("name");
  if (error) {
    if (missingProfilesTable(error.message)) return NextResponse.json({ needsMigration: true });
    return jsonError(error.message, 500);
  }
  return NextResponse.json({ setup: !data?.length, profiles: data ?? [] });
}

type Body = { profileId?: string; pin?: string; setup?: boolean; name?: string };

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => ({}))) ?? {}) as Body;
  const ip = clientIp(req);
  const lockKey = body.setup ? `setup|${ip}` : `${body.profileId ?? "?"}|${ip}`;
  const now = Date.now();

  // Per-profile, per-device lockout after repeated wrong PINs.
  const { data: attempt } = await db().from("login_attempts").select("*").eq("ip", lockKey).maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    const mins = Math.ceil((new Date(attempt.locked_until).getTime() - now) / 60_000);
    return jsonError(`Too many attempts. Try again in ${mins} min.`, 429);
  }

  async function fail(message: string) {
    const inWindow = attempt && now - new Date(attempt.first_failure_at).getTime() < WINDOW_MS;
    const failures = (inWindow ? attempt.failures : 0) + 1;
    await db().from("login_attempts").upsert({
      ip: lockKey,
      failures,
      first_failure_at: inWindow ? attempt.first_failure_at : new Date(now).toISOString(),
      locked_until: failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null,
    });
    await new Promise((r) => setTimeout(r, 700));
    const left = MAX_FAILURES - failures;
    return jsonError(left > 0 ? `${message} ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Locked for 15 min.", 401);
  }

  // ---- First-time setup: the first profile is created with the existing APP_PIN and claims all existing cards.
  if (body.setup) {
    const { count, error } = await db().from("profiles").select("id", { count: "exact", head: true });
    if (error) return jsonError(missingProfilesTable(error.message) ? "Run supabase/migrations/003_profiles.sql in Supabase first." : error.message, 500);
    if (count) return jsonError("Setup has already been done — sign in instead.", 409);

    const appPin = process.env.APP_PIN;
    if (!appPin) return jsonError("APP_PIN isn't set in Vercel, so the first profile can't be created.", 500);
    const digest = (s: string) => createHash("sha256").update(s).digest();
    if (typeof body.pin !== "string" || !timingSafeEqual(digest(body.pin), digest(appPin))) return fail("That's not the current site PIN.");

    const name = body.name?.trim();
    if (!name || name.length > 40) return jsonError("Enter your name (up to 40 characters).");

    const { data: profile, error: insErr } = await db()
      .from("profiles")
      .insert({ name, pin_hash: await hashPin(body.pin), is_admin: true })
      .select("id, session_version")
      .single();
    if (insErr || !profile) return jsonError(insErr?.message ?? "Couldn't create the profile", 500);

    // Every card created before profiles existed belongs to the first profile.
    await db().from("cards").update({ profile_id: profile.id }).is("profile_id", null);

    if (attempt) await db().from("login_attempts").delete().eq("ip", lockKey);
    const res = NextResponse.json({ ok: true });
    await setSessionCookie(res, profile);
    return res;
  }

  // ---- Normal sign-in: chosen profile + its PIN.
  if (!body.profileId || !/^[0-9a-f-]{36}$/i.test(body.profileId)) return jsonError("Choose your profile first.");
  if (!isValidPin(body.pin)) return fail(`Wrong PIN. ${PIN_RULE}`);

  const { data: profile } = await db().from("profiles").select("id, pin_hash, session_version").eq("id", body.profileId).maybeSingle();
  if (!profile || !(await checkPin(body.pin, profile.pin_hash))) return fail("Wrong PIN.");

  if (attempt) await db().from("login_attempts").delete().eq("ip", lockKey);
  const res = NextResponse.json({ ok: true });
  await setSessionCookie(res, profile);
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

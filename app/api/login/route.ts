import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/supabase";
import { createSessionToken, SESSION_COOKIE, SESSION_DAYS } from "@/lib/session";

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

const digest = (s: string) => createHash("sha256").update(s).digest();

function clientIp(req: NextRequest) {
  return req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  const expected = process.env.APP_PIN;
  if (!expected) return NextResponse.json({ error: "APP_PIN is not configured" }, { status: 500 });

  const { pin } = (await req.json().catch(() => ({}))) as { pin?: string };
  const ip = clientIp(req);
  const now = Date.now();

  const { data: attempt } = await db().from("login_attempts").select("*").eq("ip", ip).maybeSingle();
  if (attempt?.locked_until && new Date(attempt.locked_until).getTime() > now) {
    const mins = Math.ceil((new Date(attempt.locked_until).getTime() - now) / 60_000);
    return NextResponse.json({ error: `Too many attempts. Try again in ${mins} min.` }, { status: 429 });
  }

  const ok = typeof pin === "string" && timingSafeEqual(digest(pin), digest(expected));

  if (!ok) {
    const inWindow = attempt && now - new Date(attempt.first_failure_at).getTime() < WINDOW_MS;
    const failures = (inWindow ? attempt.failures : 0) + 1;
    await db().from("login_attempts").upsert({
      ip,
      failures,
      first_failure_at: inWindow ? attempt.first_failure_at : new Date(now).toISOString(),
      locked_until: failures >= MAX_FAILURES ? new Date(now + LOCK_MS).toISOString() : null,
    });
    await new Promise((r) => setTimeout(r, 700));
    const left = MAX_FAILURES - failures;
    return NextResponse.json(
      { error: left > 0 ? `Wrong PIN. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many attempts. Locked for 15 min." },
      { status: 401 },
    );
  }

  if (attempt) await db().from("login_attempts").delete().eq("ip", ip);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createSessionToken, SESSION_COOKIE, SESSION_DAYS, verifySessionToken } from "./session";
import { db } from "./supabase";

export type Profile = { id: string; name: string; is_admin: boolean; session_version: number };

/** The signed-in profile, or null. Checks the cookie AND that the profile still exists with the same session version. */
export async function currentProfile(): Promise<Profile | null> {
  const claims = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) return null;
  const { data } = await db()
    .from("profiles")
    .select("id, name, is_admin, session_version")
    .eq("id", claims.profileId)
    .maybeSingle();
  if (!data || data.session_version !== claims.version) return null;
  return data as Profile;
}

/** For API routes: returns the profile, or a 401 response to send back. */
export async function requireProfile(): Promise<Profile | NextResponse> {
  const me = await currentProfile();
  return me ?? NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

export async function requireAdmin(): Promise<Profile | NextResponse> {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  return me.is_admin ? me : NextResponse.json({ error: "Only an admin can do that" }, { status: 403 });
}

export async function setSessionCookie(res: NextResponse, profile: Pick<Profile, "id" | "session_version">) {
  res.cookies.set(SESSION_COOKIE, await createSessionToken(profile.id, profile.session_version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

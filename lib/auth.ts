import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./session";

/** Second line of defence behind the proxy: every API route checks the session itself. */
export async function requireAuth(): Promise<NextResponse | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (await verifySessionToken(token)) return null;
  return NextResponse.json({ error: "Not signed in" }, { status: 401 });
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

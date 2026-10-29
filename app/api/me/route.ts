import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";

/** Who is signed in (for the header). */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  return NextResponse.json({ id: me.id, name: me.name, is_admin: me.is_admin });
}

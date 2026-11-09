import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { setChoices } from "@/lib/scan";

/** Sets you can scan into: the approved list plus your own collections, with checklist sizes. */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  return NextResponse.json({ sets: await setChoices(me.id) });
}

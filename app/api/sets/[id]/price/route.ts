import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { getSet, priceSet } from "@/lib/checklist";

export const maxDuration = 120;

/** One price lookup for the whole set. Never overwrites a card that already has a value. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  try {
    return NextResponse.json(await priceSet(me.id, set));
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Couldn't price the set", 502);
  }
}

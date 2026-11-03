import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { getSet, linkExistingCards } from "@/lib/checklist";

export const maxDuration = 60;

/** Redo matching your cards to this set's checklist (no search). Your scanned cards are trusted. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  return NextResponse.json(await linkExistingCards(me.id, set, { reset: true }));
}

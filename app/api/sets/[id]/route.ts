import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { getSet } from "@/lib/checklist";
import { setCardsOf, setsOf } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/** Stop tracking: removes the checklist. Your cards stay exactly as they are. */
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  await setCardsOf(me.id).delete().eq("set_id", set.id); // owned cards' links clear automatically
  await setsOf(me.id).update({ tracking: false, total: 0, source: null, source_url: null, priced_at: null }).eq("id", set.id);
  return NextResponse.json({ ok: true });
}

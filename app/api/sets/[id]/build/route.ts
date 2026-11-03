import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { buildChecklist, getSet } from "@/lib/checklist";

export const maxDuration = 120;

/** Find the set's checklist online (or read a pasted one) and link the cards you own. Body: { pasted?: string } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  const body = (await req.json().catch(() => ({}))) as { pasted?: string; force?: boolean };
  try {
    // force: "Find checklist again" — ignore the shared library's copy and search afresh.
    const r = await buildChecklist(me.id, set, body?.pasted, { force: !!body?.force });
    if (!r.ok) return jsonError("Couldn't find a checklist for this set online. You can paste one instead.", 404);
    return NextResponse.json(r);
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Couldn't build the checklist", 502);
  }
}

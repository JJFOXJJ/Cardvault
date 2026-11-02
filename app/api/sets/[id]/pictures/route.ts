import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { findPictures, getSet } from "@/lib/checklist";

export const maxDuration = 90;

/** Find pictures for ticked cards without one. Body: { ids?: string[] } — checklist entry ids (all owned if omitted). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  const body = (await req.json().catch(() => ({}))) as { ids?: string[] };
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string" && /^[0-9a-f-]{36}$/i.test(x)) : undefined;
  try {
    return NextResponse.json(await findPictures(me.id, set, ids));
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Couldn't find pictures", 502);
  }
}

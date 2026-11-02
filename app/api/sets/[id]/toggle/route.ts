import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { getSet, setOwned } from "@/lib/checklist";

/** Tick or untick checklist cards. Body: { ids: string[], owned: boolean, force?: boolean } */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const set = await getSet(me.id, (await params).id);
  if (!set) return jsonError("Set not found", 404);
  const body = (await req.json().catch(() => null)) as { ids?: string[]; owned?: boolean; force?: boolean } | null;
  if (!Array.isArray(body?.ids) || typeof body.owned !== "boolean") return jsonError("Nothing to change");
  try {
    const r = await setOwned(me.id, set, body.ids, body.owned, !!body.force);
    if ("needsConfirm" in r && r.needsConfirm) return NextResponse.json(r, { status: 409 });
    return NextResponse.json(r);
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Update failed", 500);
  }
}

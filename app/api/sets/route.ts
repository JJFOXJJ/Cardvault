import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { setsOf } from "@/lib/supabase";

const missingTable = (m?: string) => !!m && /sets|set_cards|checklist_id|schema cache|relation/i.test(m);

/** GET /api/sets?name=X → is this collection tracked, declined, or new? */
export async function GET(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name) return jsonError("Missing name");
  const { data, error } = await setsOf(me.id).select("id, tracking, total").ilike("name", name.replace(/[%_]/g, "\\$&")).maybeSingle();
  if (error) return missingTable(error.message) ? NextResponse.json({ available: false }) : jsonError(error.message, 500);
  return NextResponse.json({ available: true, set: data ?? null });
}

/** POST /api/sets { name, tracking } → create (or update) the set row. The checklist is built separately. */
export async function POST(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const body = (await req.json().catch(() => null)) as { name?: string; tracking?: boolean } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 200) return jsonError("Missing set name");
  const tracking = body?.tracking !== false;

  const { data: existing, error: e1 } = await setsOf(me.id).select("id").ilike("name", name.replace(/[%_]/g, "\\$&")).maybeSingle();
  if (e1) return jsonError(missingTable(e1.message) ? "Set tracking needs a quick database update — run supabase/migrations/005_sets.sql in Supabase." : e1.message, 500);
  if (existing) {
    await setsOf(me.id).update({ tracking }).eq("id", existing.id);
    return NextResponse.json({ id: existing.id });
  }
  const { data, error } = await setsOf(me.id).insert({ name, tracking }).select("id").single();
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ id: data.id });
}

import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin, requireProfile } from "@/lib/auth";
import { hashPin, isValidPin, PIN_RULE } from "@/lib/pin";
import { db } from "@/lib/supabase";

/** Admins see every profile with card counts (never the cards themselves); others see only themselves. */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;

  const q = db().from("profiles").select("id, name, is_admin, created_at").order("created_at");
  const { data, error } = me.is_admin ? await q : await q.eq("id", me.id);
  if (error) return jsonError(error.message, 500);

  // Counts only — admins can't browse another profile's collection.
  const counts = new Map<string, number>();
  if (me.is_admin) {
    const { data: rows } = await db().from("cards").select("profile_id, quantity");
    for (const r of rows ?? []) counts.set(r.profile_id, (counts.get(r.profile_id) ?? 0) + (r.quantity ?? 1));
  }
  return NextResponse.json({
    me: { id: me.id, name: me.name, is_admin: me.is_admin },
    profiles: (data ?? []).map((p) => ({ ...p, cards: me.is_admin ? counts.get(p.id) ?? 0 : undefined })),
  });
}

/** Admin: create a profile. */
export async function POST(req: NextRequest) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const body = (await req.json().catch(() => null)) as { name?: string; pin?: string; is_admin?: boolean } | null;
  const name = body?.name?.trim();
  if (!name || name.length > 40) return jsonError("Enter a name (up to 40 characters).");
  if (!isValidPin(body?.pin)) return jsonError(PIN_RULE);

  const { data, error } = await db()
    .from("profiles")
    .insert({ name, pin_hash: await hashPin(body.pin), is_admin: !!body.is_admin })
    .select("id, name, is_admin, created_at")
    .single();
  if (error) return jsonError(/duplicate|unique/i.test(error.message) ? "There's already a profile with that name." : error.message, 400);
  return NextResponse.json({ profile: data });
}

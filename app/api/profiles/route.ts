import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin, requireProfile } from "@/lib/auth";
import { hashPin, isValidPin, PIN_RULE } from "@/lib/pin";
import { db } from "@/lib/supabase";

/** Admins see every profile with card counts and total value (never the cards themselves); others see only themselves. */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;

  const q = db().from("profiles").select("id, name, is_admin, created_at").order("created_at");
  const { data, error } = me.is_admin ? await q : await q.eq("id", me.id);
  if (error) return jsonError(error.message, 500);

  // Totals only — admins can't browse another profile's collection.
  // Matches the home screen: catalogued cards, value = estimate × quantity. Cards waiting to be identified are counted separately.
  const ids = (data ?? []).map((p) => p.id);
  const stats = new Map<string, { cards: number; value: number; waiting: number }>();
  for (const id of ids) stats.set(id, { cards: 0, value: 0, waiting: 0 });
  const PAGE = 1000; // Supabase returns at most 1,000 rows per request
  for (let from = 0; ids.length; from += PAGE) {
    const { data: rows, error: e } = await db().from("cards").select("profile_id, quantity, aud_mid, status")
      .in("profile_id", ids).order("id").range(from, from + PAGE - 1);
    if (e) return jsonError(e.message, 500);
    for (const r of rows ?? []) {
      const s = stats.get(r.profile_id);
      if (!s) continue;
      const q = r.quantity ?? 1;
      if (r.status === "pending") s.waiting += q;
      else { s.cards += q; s.value += Number(r.aud_mid ?? 0) * q; }
    }
    if ((rows ?? []).length < PAGE) break;
  }
  return NextResponse.json({
    me: { id: me.id, name: me.name, is_admin: me.is_admin },
    profiles: (data ?? []).map((p) => {
      const s = stats.get(p.id)!;
      return { ...p, cards: s.cards, value: Math.round(s.value * 100) / 100, waiting: s.waiting };
    }),
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

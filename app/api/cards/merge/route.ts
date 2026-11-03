import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { cardsOf, removeStoredImage, type Card } from "@/lib/supabase";
import { stackKey } from "@/lib/stack";

/**
 * Merge copies of the same card (saved separately) into one card with the total quantity.
 * Keeps the best copy (linked to a set, then with an online picture, then the oldest) and fills its gaps from the others.
 */
export async function POST(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const body = (await req.json().catch(() => null)) as { ids?: string[] } | null;
  const ids = [...new Set((body?.ids ?? []).filter((x) => typeof x === "string"))];
  if (ids.length < 2 || ids.length > 50) return jsonError("Choose at least two copies to merge.");

  const { data, error } = await cardsOf(me.id).select("*").in("id", ids);
  if (error) return jsonError(error.message, 500);
  const cards = (data ?? []) as Card[];
  if (cards.length !== ids.length) return jsonError("Card not found", 404);
  const keys = new Set(cards.map((c) => stackKey(c)));
  if (keys.size !== 1 || keys.has(null)) return jsonError("Those aren't copies of the same card.");
  if (cards.some((c) => c.status === "pending")) return jsonError("Identify waiting cards before merging them.");

  const score = (c: Card) => (c.checklist_id ? 4 : 0) + (c.image_url && c.image_url !== c.photo_url ? 2 : 0) + (c.aud_mid != null ? 1 : 0);
  const [keep, ...rest] = [...cards].sort((a, b) => score(b) - score(a) || a.created_at.localeCompare(b.created_at));

  const fill = <K extends keyof Card>(k: K) => keep[k] ?? rest.find((c) => c[k] != null)?.[k] ?? null;
  const notes = [keep.notes, ...rest.map((c) => c.notes)].filter((n): n is string => !!n?.trim());
  const update: Record<string, unknown> = {
    quantity: cards.reduce((n, c) => n + (c.quantity ?? 1), 0),
    notes: [...new Set(notes)].join("\n") || null,
    updated_at: new Date().toISOString(),
  };
  if (keep.aud_mid == null) {
    const priced = rest.find((c) => c.aud_mid != null);
    if (priced) Object.assign(update, { aud_low: priced.aud_low, aud_mid: priced.aud_mid, aud_high: priced.aud_high, value_usd_mid: priced.value_usd_mid,
      fx_usd_aud: priced.fx_usd_aud, value_notes: priced.value_notes, price_sources: priced.price_sources, priced_at: priced.priced_at, confidence: priced.confidence });
  }
  for (const k of ["year", "manufacturer", "subject", "condition", "photo_url", "back_photo_url"] as const) if (keep[k] == null) update[k] = fill(k);
  if (!keep.image_url) update.image_url = fill("image_url");
  const checklist = keep.checklist_id ?? rest.find((c) => c.checklist_id)?.checklist_id ?? null;

  // Delete the extra copies first (a set checklist entry can only link to one card), then update the keeper.
  const { error: delErr } = await cardsOf(me.id).delete().in("id", rest.map((c) => c.id));
  if (delErr) return jsonError(delErr.message, 500);
  const { error: upErr } = await cardsOf(me.id).update(checklist !== keep.checklist_id ? { ...update, checklist_id: checklist } : update).eq("id", keep.id);
  if (upErr) return jsonError(upErr.message, 500);

  // Tidy up the removed copies' own photos — unless the kept card now uses them.
  const used = new Set([keep.photo_url, keep.back_photo_url, keep.image_url, update.photo_url, update.back_photo_url, update.image_url].filter(Boolean));
  for (const c of rest) for (const u of [c.photo_url, c.back_photo_url]) if (u && !used.has(u) && u.includes("/photos/")) await removeStoredImage(u).catch(() => {});

  return NextResponse.json({ ok: true, id: keep.id, quantity: update.quantity, merged: rest.length });
}

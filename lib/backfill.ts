// One-off: fill the shared library from what profiles already have, so past lookups are reused.
// Copies only ONLINE pictures (never owners' photos), recent prices, and web/pasted checklists.

import { BUCKET, db } from "./supabase";
import { allRows } from "./paging";
import { pictureKey, priceKey, saveSharedPicture, saveSharedSet, setKey, sharedPictures, PRICE_TTL_DAYS } from "./shared";

const marker = `/storage/v1/object/public/${BUCKET}/`;

type Row = {
  id: string; set_name: string | null; card_number: string | null; subject: string | null; name: string; variant: string | null; graded: string | null;
  image_url: string | null; photo_url: string | null; image_source: string | null; confidence: string | null;
  value_usd_mid: number | null; aud_low: number | null; aud_high: number | null; fx_usd_aud: number | null;
  value_notes: string | null; price_sources: { title: string; url: string }[] | null; priced_at: string | null; status: string;
};

export async function backfillLibrary(budgetMs = 40_000) {
  const started = Date.now();
  const out = { sets: 0, prices: 0, pictures: 0, picturesLeft: 0 };

  const { data: cards, error } = await allRows<Row>((from, to) => db().from("cards")
    .select("id, set_name, card_number, subject, name, variant, graded, image_url, photo_url, image_source, confidence, value_usd_mid, aud_low, aud_high, fx_usd_aud, value_notes, price_sources, priced_at, status")
    .neq("status", "pending").order("id").range(from, to));
  if (error) throw new Error(error.message);
  const good = cards.filter((c) => c.confidence !== "low");

  // 1. Checklists (web or pasted), with their price estimates.
  const { data: sets } = await allRows<{ id: string; profile_id: string; name: string; source: string | null; source_url: string | null; priced_at: string | null }>(
    (from, to) => db().from("sets").select("id, profile_id, name, source, source_url, priced_at").not("source", "is", null).order("id").range(from, to));
  const { data: existingSets } = await db().from("shared_sets").select("key");
  const have = new Set((existingSets ?? []).map((r) => r.key));
  for (const s of sets ?? []) {
    if (s.source === "pokemon" || have.has(setKey(s.name) ?? "")) continue;
    const { data: entries } = await db().from("set_cards").select("number, name, subset, est_aud, sort").eq("set_id", s.id).eq("profile_id", s.profile_id).order("sort");
    if ((entries ?? []).length < 8) continue;
    await saveSharedSet(s.name, s.source ?? "web", s.source_url, entries!, s.priced_at);
    have.add(setKey(s.name)!);
    out.sets++;
  }

  // 2. Prices from the last 30 days (not set estimates, which are rougher).
  const cutoff = Date.now() - PRICE_TTL_DAYS * 86_400_000;
  const prices = new Map<string, Record<string, unknown>>();
  for (const c of good) {
    if (!c.priced_at || Date.parse(c.priced_at) < cutoff || c.confidence === "estimate" || c.value_usd_mid == null || !c.fx_usd_aud) continue;
    const key = priceKey(c);
    if (!key) continue;
    const prev = prices.get(key);
    if (prev && String(prev.priced_at) > c.priced_at) continue;
    const usd = (aud: number | null) => (aud == null ? c.value_usd_mid! : Math.round((aud / c.fx_usd_aud!) * 100) / 100);
    prices.set(key, { key, value_usd: { low: usd(c.aud_low), mid: c.value_usd_mid, high: usd(c.aud_high) }, value_notes: c.value_notes ?? "", price_sources: c.price_sources ?? [], priced_at: c.priced_at });
  }
  if (prices.size) {
    const { error: pe } = await db().from("shared_prices").upsert([...prices.values()], { onConflict: "key", ignoreDuplicates: true });
    if (!pe) out.prices = prices.size;
  }

  // 3. Online pictures (copied into shared/ so deleting a card never breaks them).
  const picks = new Map<string, Row>();
  for (const c of good) {
    if (!c.image_url || c.image_url === c.photo_url || !c.image_url.includes(marker)) continue;
    const path = c.image_url.slice(c.image_url.indexOf(marker) + marker.length);
    if (path.startsWith("photos/")) continue;
    const key = pictureKey(c);
    if (key && !picks.has(key)) picks.set(key, c);
  }
  const already = await sharedPictures([...picks.keys()]);
  const todo = [...picks.entries()].filter(([k]) => !already.has(k));
  for (const [i, [key, c]] of todo.entries()) {
    if (Date.now() - started > budgetMs) { out.picturesLeft = todo.length - i; break; }
    const from = c.image_url!.slice(c.image_url!.indexOf(marker) + marker.length);
    const to = `shared/${crypto.randomUUID()}.${from.split(".").pop() || "webp"}`;
    const { error: ce } = await db().storage.from(BUCKET).copy(from, to);
    if (ce) continue;
    await saveSharedPicture(key, db().storage.from(BUCKET).getPublicUrl(to).data.publicUrl, c.image_source);
    out.pictures++;
  }
  return out;
}

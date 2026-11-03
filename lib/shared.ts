// The shared card library. Things found ONLINE are saved once and reused by every profile:
//   • set checklists (and the set's price estimates)
//   • clean card pictures
//   • card prices (re-checked after 30 days)
// Owners' own photos and cards are never put here. If migration 006 hasn't been run,
// every lookup is simply a miss and the app works as before.

import { BUCKET, db, storeImage } from "./supabase";
import { setTokens } from "./collections";
import { recordUsage } from "./usage";
import type { Range } from "./ai";

export const PRICE_TTL_DAYS = 30;
const fresh = (iso: string | null | undefined, days = PRICE_TTL_DAYS) => !!iso && Date.now() - Date.parse(iso) < days * 86_400_000;

const normNum = (n: string | null | undefined) => (n ?? "").toString().trim().toLowerCase().replace(/^#/, "").replace(/^0+(?=\d)/, "").replace(/\s+/g, "");
const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/#\s*\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const normText = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9/]+/g, " ").trim();

/** "1990 Impel Marvel Universe" and "Marvel Universe 1990 Impel" give the same key. */
export function setKey(name: string | null | undefined): string | null {
  if (!name?.trim()) return null;
  const t = [...new Set(setTokens(name))].sort();
  return t.length ? t.join(" ") : null;
}

type CardRef = { set_name?: string | null; card_number?: string | null; subject?: string | null; name?: string | null; variant?: string | null; graded?: string | null };

/** Same picture: same set and number (or name when unnumbered), same variant. */
export function pictureKey(c: CardRef): string | null {
  const s = setKey(c.set_name);
  const num = normNum(c.card_number);
  const who = normName(c.subject || c.name);
  if (!s || (!num && !who)) return null;
  return [s, num ? `#${num}` : `n:${who}`, normText(c.variant)].join("|");
}

/** Same price: as above plus the grade (a PSA 10 is worth far more than a raw copy). */
export function priceKey(c: CardRef): string | null {
  const p = pictureKey(c);
  return p ? `${p}|${normText(c.graded)}` : null;
}

/** Note a search we didn't need to make (shown on the admin page). */
export const countSaved = (profileId: string | undefined, n = 1) => recordUsage("saved", profileId, n);

// ---------------------------------------------------------------- pictures

/** Only pictures in this app's own storage, under shared/. */
export const isSharedImage = (url: string | null | undefined) => {
  const base = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  return !!url && !!base && url.startsWith(`${base}/storage/v1/object/public/${BUCKET}/shared/`) && !url.includes("..");
};

export async function sharedPictures(keys: (string | null)[]): Promise<Map<string, string>> {
  const list = [...new Set(keys.filter((k): k is string => !!k))];
  const out = new Map<string, string>();
  for (let i = 0; i < list.length; i += 200) {
    const { data, error } = await db().from("shared_pictures").select("key, image_url").in("key", list.slice(i, i + 200));
    if (error) return out;
    for (const r of data ?? []) out.set(r.key, r.image_url);
  }
  return out;
}

export async function sharedPicture(key: string | null): Promise<string | null> {
  if (!key) return null;
  return (await sharedPictures([key])).get(key) ?? null;
}

/** Remember a picture for everyone. First one wins (it's already in use by someone). */
export async function saveSharedPicture(key: string | null, imageUrl: string, source?: string | null) {
  if (!key || !isSharedImage(imageUrl)) return;
  await db().from("shared_pictures").upsert({ key, image_url: imageUrl, source: source ?? null }, { onConflict: "key", ignoreDuplicates: true }).then(() => {}, () => {});
}

/**
 * Store a chosen ONLINE picture for a card:
 *  • already a library picture → reuse it as is (no download, nothing stored twice)
 *  • nobody has one for this card yet → save it to the library and use that copy
 *  • otherwise (or for low-confidence identifications) → a private copy for this card only
 * Never call this with the owner's own photo.
 */
export async function keepPicture(src: string, card: CardRef & { confidence?: string | null }, source?: string | null): Promise<string> {
  if (isSharedImage(src)) return src;
  const key = card.confidence === "low" ? null : pictureKey(card);
  if (key && !(await sharedPicture(key).catch(() => null))) {
    const url = await storeImage(src, "shared");
    await saveSharedPicture(key, url, source);
    return url;
  }
  return storeImage(src, "official");
}

// ---------------------------------------------------------------- prices

export type SharedPrice = { value_usd: Range | null; value_notes: string; price_sources: { title: string; url: string }[]; priced_at: string };

export async function sharedPrice(key: string | null): Promise<SharedPrice | null> {
  if (!key) return null;
  const { data, error } = await db().from("shared_prices").select("value_usd, value_notes, price_sources, priced_at").eq("key", key).maybeSingle();
  if (error || !data || !fresh(data.priced_at) || !data.value_usd) return null;
  return data as SharedPrice;
}

export async function saveSharedPrice(key: string | null, v: { value_usd: Range | null; value_notes: string; price_sources: { title: string; url: string }[] }) {
  if (!key || !v.value_usd) return;
  await db().from("shared_prices")
    .upsert({ key, value_usd: v.value_usd, value_notes: v.value_notes, price_sources: v.price_sources, priced_at: new Date().toISOString() }, { onConflict: "key" })
    .then(() => {}, () => {});
}

// ---------------------------------------------------------------- sets

export type SharedEntry = { number: string | null; name: string; subset: string | null; est_aud?: number | null };
export type SharedSet = { key: string; name: string; source: string | null; source_url: string | null; entries: SharedEntry[]; total: number; priced_at: string | null };

export async function sharedSet(name: string): Promise<SharedSet | null> {
  const key = setKey(name);
  if (!key) return null;
  const { data, error } = await db().from("shared_sets").select("key, name, source, source_url, entries, total, priced_at").eq("key", key).maybeSingle();
  if (error || !data || !Array.isArray(data.entries) || data.entries.length < 8) return null;
  return data as SharedSet;
}

/** Save a checklist for everyone. A web/Pokémon list replaces a pasted one; otherwise the first one stays. */
export async function saveSharedSet(name: string, source: string, sourceUrl: string | null, entries: SharedEntry[], pricedAt: string | null) {
  const key = setKey(name);
  if (!key || entries.length < 8) return;
  const existing = await sharedSet(name);
  if (existing && !(existing.source === "manual" && source !== "manual")) return;
  await db().from("shared_sets")
    .upsert({ key, name, source, source_url: sourceUrl, entries: entries.map(({ number, name, subset, est_aud }) => ({ number, name, subset, est_aud: est_aud ?? null })),
      total: entries.length, priced_at: pricedAt, updated_at: new Date().toISOString() }, { onConflict: "key" })
    .then(() => {}, () => {});
}

/** Fresh set prices (looked up in the last 30 days), matched by card number then name. */
export function sharedSetPrices(s: SharedSet | null) {
  if (!s || !fresh(s.priced_at)) return null;
  const byNum = new Map<string, number>(), byName = new Map<string, number>();
  for (const e of s.entries) {
    if (e.est_aud == null) continue;
    if (e.number) byNum.set(normNum(e.number), e.est_aud);
    byName.set(normName(e.name), e.est_aud);
  }
  if (!byNum.size && !byName.size) return null;
  return {
    pricedAt: s.priced_at!,
    find: (e: { number: string | null; name: string }) => (e.number ? byNum.get(normNum(e.number)) : undefined) ?? byName.get(normName(e.name)) ?? null,
  };
}

/** Store a set's new price estimates in the library. */
export async function saveSharedSetPrices(name: string, values: { number: string | null; name: string; est_aud: number }[]) {
  const s = await sharedSet(name);
  if (!s) return;
  const byNum = new Map<string, number>(), byName = new Map<string, number>();
  for (const v of values) { if (v.number) byNum.set(normNum(v.number), v.est_aud); byName.set(normName(v.name), v.est_aud); }
  const entries = s.entries.map((e) => ({ ...e, est_aud: (e.number ? byNum.get(normNum(e.number)) : undefined) ?? byName.get(normName(e.name)) ?? e.est_aud ?? null }));
  await db().from("shared_sets").update({ entries, priced_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("key", s.key).then(() => {}, () => {});
}

/** For the admin page. */
export async function libraryStats() {
  const count = async (t: string) => {
    const { count, error } = await db().from(t).select("key", { count: "exact", head: true });
    return error ? null : count ?? 0;
  };
  const [sets, pictures, prices] = await Promise.all([count("shared_sets"), count("shared_pictures"), count("shared_prices")]);
  return { available: sets != null, sets: sets ?? 0, pictures: pictures ?? 0, prices: prices ?? 0 };
}

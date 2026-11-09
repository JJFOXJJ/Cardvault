// Set-first scanning: the owner picks the set; the AI only reads the card's number and name;
// the app matches that reading to the set's checklist. The AI never names the set.

import { readCard, priceCardShared, type CardReading, type Identification } from "./ai";
import type { ImageCandidate } from "./images";
import { imageSearch, searchAllowed, searchConfigured } from "./search";
import { countSaved, pictureKey, sharedPicture, sharedSet } from "./shared";
import { isInsertCard, normName, normNum, samePerson, type ChecklistEntry } from "./checklist";
import { canonicalSetName, catalog } from "./catalog";
import { cardsOf, setCardsOf, setsOf } from "./supabase";
import { round, usdToAud } from "./fx";
import type { IdentifyResult } from "./identify";

const esc = (s: string) => s.replace(/[%_]/g, "\\$&");

// ---------------------------------------------------------------- which sets can be chosen

export type SetChoice = { name: string; checklist: number; approved: boolean; yours: number; category: string | null };

/** Sets to scan into: the approved list (with checklists) plus your own collections. */
export async function setChoices(profileId: string): Promise<SetChoice[]> {
  const [{ sets }, { data: mine }] = await Promise.all([
    catalog(),
    cardsOf(profileId).select("set_name, quantity").not("set_name", "is", null),
  ]);
  const yours = new Map<string, number>();
  for (const c of mine ?? []) { const n = (c.set_name as string).trim(); if (n) yours.set(n, (yours.get(n) ?? 0) + (c.quantity ?? 1)); }
  const out = new Map<string, SetChoice>();
  for (const s of sets) out.set(s.name.toLowerCase(), { name: s.name, checklist: s.checklist.length, approved: true, yours: 0, category: s.category });
  for (const [n, count] of yours) {
    const approved = await canonicalSetName(n, sets);
    const key = (approved ?? n).toLowerCase();
    const prev = out.get(key);
    if (prev) prev.yours += count;
    else out.set(key, { name: n, checklist: 0, approved: false, yours: count, category: null });
  }
  // Your own collections that have a checklist only in your tracked set or the shared library.
  for (const c of out.values()) {
    if (c.checklist) continue;
    const list = await checklistForSet(profileId, c.name).catch(() => null);
    c.checklist = list?.entries.length ?? 0;
  }
  return [...out.values()].sort((a, b) => b.yours - a.yours || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- the chosen set's checklist

export type SetChecklist = { name: string; entries: ChecklistEntry[]; source: string; meta: { category: string | null; year: string | null; manufacturer: string | null } };

/** The checklist to match against: approved list → your tracked set → shared library. */
export async function checklistForSet(profileId: string, setName: string): Promise<SetChecklist | null> {
  const { sets } = await catalog();
  const approvedName = await canonicalSetName(setName, sets);
  const cat = approvedName ? sets.find((s) => s.name === approvedName) ?? null : null;
  const name = approvedName ?? setName.trim();

  // Details: the approved list, else the most common values on your cards in this set.
  const { data: mine } = await cardsOf(profileId).select("category, year, manufacturer").ilike("set_name", esc(name)).neq("status", "pending").limit(50);
  const mode = (k: "category" | "year" | "manufacturer") => {
    const m = new Map<string, number>();
    for (const r of mine ?? []) if (r[k]) m.set(r[k], (m.get(r[k]) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  const meta = { category: cat?.category ?? mode("category"), year: cat?.year ?? mode("year"), manufacturer: cat?.manufacturer ?? mode("manufacturer") };

  if (cat?.checklist.length) return { name, entries: cat.checklist, source: "approved", meta };
  const { data: tracked } = await setsOf(profileId).select("id, total").ilike("name", esc(name)).maybeSingle();
  if (tracked?.total) {
    const { data: rows } = await setCardsOf(profileId).select("number, name, subset, image_url, est_aud, sort").eq("set_id", tracked.id).order("sort");
    if (rows?.length) return { name, entries: rows.map((r) => ({ number: r.number, name: r.name, subset: r.subset, image_url: r.image_url, est_aud: r.est_aud == null ? null : Number(r.est_aud) })), source: "tracked", meta };
  }
  const lib = await sharedSet(name).catch(() => null);
  if (lib?.entries.length) return { name, entries: lib.entries, source: "library", meta };
  return null;
}

// ---------------------------------------------------------------- matching a reading to the checklist

export type Match = {
  status: "exact" | "number" | "name" | "ambiguous" | "conflict" | "insert" | "none" | "no-checklist";
  entry: ChecklistEntry | null;
  alternatives: { number: string | null; name: string; subset: string | null }[];
  note: string;
};

const sameInsert = (insert: string, subset: string | null) => {
  if (!subset) return false;
  const a = normName(insert).split(" ").filter((w) => w.length > 2 && !["insert", "card", "parallel", "the", "and"].includes(w));
  const b = new Set(normName(subset).split(" "));
  return a.length > 0 && a.some((w) => b.has(w));
};

/**
 * Match what the AI read to the checklist.
 * `anchors` = numbers of cards you already have in this set (used to choose between a player's several cards).
 */
export function matchReading(r: CardReading, entries: ChecklistEntry[], anchors: number[] = []): Match {
  const alt = (e: ChecklistEntry) => ({ number: e.number, name: e.name, subset: e.subset });
  const num = normNum(r.number);
  // Insert cards only match entries of that insert set; base cards only match non-insert entries.
  const insertRows = r.insert ? entries.filter((e) => sameInsert(r.insert!, e.subset)) : [];
  if (r.insert && !insertRows.length && !/\b(holo|reverse|foil|rookie|rc)\b/i.test(r.insert)) {
    return { status: "insert", entry: null, alternatives: [], note: `This is a “${r.insert}” insert, which isn't on this set's checklist. Saved with the number and name as read.` };
  }
  // A base card is matched against base entries only (Pokémon rarities like "Rare Holo" count as base).
  const insertSubset = (sub: string | null) => !!sub && !/^(base( set)?|common|uncommon|rare.*|.*\brare|promo|rookie.*|holo.*|reverse.*|.*holo)$/i.test(sub.trim());
  const basePool = entries.filter((e) => !insertSubset(e.subset));
  const pool = insertRows.length ? insertRows : basePool.length ? basePool : entries;
  const byNum = num ? pool.filter((e) => normNum(e.number) === num) : [];
  const nameHits = r.name ? pool.filter((e) => samePerson(r.name, e.name)) : [];
  const exactName = nameHits.filter((e) => normName(e.name) === normName(r.name));
  const byName = exactName.length ? exactName : nameHits;
  const both = byNum.filter((e) => byName.includes(e));
  const label = (e: ChecklistEntry) => `#${e.number ?? "—"} ${e.name}`;

  if (both.length) return { status: "exact", entry: both[0], alternatives: [], note: `Matched ${label(both[0])} on the checklist.` };
  if (byNum.length && !r.name) return { status: "number", entry: byNum[0], alternatives: [], note: `Matched by number: ${label(byNum[0])}.` };
  if (byName.length === 1) {
    return { status: "name", entry: byName[0], alternatives: byNum.map(alt),
      note: num ? `The number read (${r.number}) doesn't match — the checklist has ${r.name} as #${byName[0].number}. Using the checklist number.` : `No number visible — matched by name: ${label(byName[0])}.` };
  }
  if (byName.length > 1) {
    const near = (e: ChecklistEntry) => anchors.filter((a) => Math.abs(a - Number(normNum(e.number))) <= 40).length;
    const ranked = [...byName].sort((a, b) => near(b) - near(a));
    return { status: "ambiguous", entry: ranked[0], alternatives: ranked.map(alt),
      note: `${r.name} has ${byName.length} cards in this set (${byName.map((e) => `#${e.number}`).join(", ")}). Picked #${ranked[0].number}${near(ranked[0]) ? " (near your other cards)" : ""} — check the number on the back.` };
  }
  if (byNum.length) {
    return { status: "conflict", entry: byNum[0], alternatives: [alt(byNum[0])],
      note: `The checklist has ${label(byNum[0])}, but the card reads “${r.name}”. Check the card is from this set.` };
  }
  return { status: "none", entry: null, alternatives: [], note: `“${r.name ?? "This card"}”${r.number ? ` #${r.number}` : ""} isn't on this set's checklist. Saved as read — check it's the right set.` };
}

// ---------------------------------------------------------------- the whole scan

export type InSetResult = IdentifyResult & { match: Match; reading: CardReading; setSource: string };

/** Identify a card within the chosen set. The saved set name is always the chosen set. */
export async function runIdentifyInSet(profileId: string, images: { mediaType: string; data: string }[], setName: string, hint?: string | null): Promise<InSetResult> {
  const name = setName.trim();
  if (!name) throw new Error("Choose the set first.");
  const searchCapped = searchConfigured() && !(await searchAllowed());
  const list = await checklistForSet(profileId, name);
  const chosen = list?.name ?? name; // the approved spelling of the chosen set (never a new name)
  const reading = await readCard(images, chosen, hint ?? undefined, profileId);

  const { data: mine } = await cardsOf(profileId).select("card_number").ilike("set_name", esc(chosen)).neq("status", "pending");
  const anchors = (mine ?? []).map((c) => Number(normNum(c.card_number))).filter((n) => Number.isFinite(n) && n > 0);
  const match: Match = list ? matchReading(reading, list.entries, anchors)
    : { status: "no-checklist", entry: null, alternatives: [], note: "This set has no checklist yet, so the card is saved exactly as read. An admin can add the checklist under Admin → Add a set." };

  const e = match.entry;
  const subject = e?.name ?? reading.name ?? "Unknown card";
  const number = e?.number ?? reading.number;
  const variant = e?.subset && !/^(common|uncommon|rare|base)$/i.test(e.subset) ? e.subset : reading.insert;
  const confidence: Identification["confidence"] =
    match.status === "exact" ? reading.confidence : match.status === "number" || match.status === "name" ? (reading.confidence === "low" ? "low" : "medium") : "low";
  const isPokemon = /pok[eé]mon/i.test(`${list?.meta.category ?? ""} ${chosen}`) || reading.is_pokemon;

  const card: Identification = {
    identified: !!(e || reading.name),
    confidence,
    category: list?.meta.category ?? (isPokemon ? "Pokémon" : "Other"),
    name: `${subject}${number ? ` #${number}` : ""}`,
    subject,
    year: list?.meta.year ?? null,
    manufacturer: list?.meta.manufacturer ?? null,
    set_name: chosen,
    card_number: number,
    variant: variant ?? null,
    graded: reading.graded,
    value_usd: null, value_notes: "", price_sources: [],
    image_query: [chosen, subject, number ? `#${number}` : null, variant, "card"].filter(Boolean).join(" "),
    price_query: [chosen, subject, number ? `#${number}` : null, variant, reading.graded, "sold price"].filter(Boolean).join(" "),
    is_pokemon: isPokemon,
    found_images: [],
  };

  // Value: the checklist's own estimate (e.g. Pokémon market price) when there is one; otherwise the usual lookup.
  const fx = await usdToAud();
  let aud: InSetResult["aud"] = null;
  if (e?.est_aud != null && !reading.graded) {
    aud = { low: round(e.est_aud * 0.8), mid: e.est_aud, high: round(e.est_aud * 1.25) };
    card.value_usd = { low: (e.est_aud * 0.8) / fx, mid: e.est_aud / fx, high: (e.est_aud * 1.25) / fx };
    card.value_notes = "Market price from the set's checklist.";
    await countSaved(profileId);
  } else {
    const v = await priceCardShared(card, card.price_query, profileId);
    card.value_usd = v.value_usd; card.value_notes = v.value_notes; card.price_sources = v.price_sources; card.found_images = v.images ?? [];
    if (v.value_usd) aud = { low: round(v.value_usd.low * fx), mid: round(v.value_usd.mid * fx), high: round(v.value_usd.high * fx) };
  }

  // Pictures: the checklist's official picture → shared library → pictures from the price search → a picture search.
  const candidates: ImageCandidate[] = [];
  if (e?.image_url) candidates.push({ url: e.image_url, thumb: e.image_url, origin: "pokemontcg", title: `${subject} · official picture` });
  const shared = await sharedPicture(pictureKey(card)).catch(() => null);
  if (shared && !candidates.some((c) => c.url === shared)) candidates.push({ url: shared, thumb: shared, origin: "shared", title: "From the shared library" });
  for (const im of card.found_images) if (!candidates.some((c) => c.url === im.url)) candidates.push(im);
  if (!candidates.length || (candidates.every((c) => c.origin === "web") && candidates.length < 3)) {
    candidates.push(...(await imageSearch(card.image_query, 8 - candidates.length, profileId).catch(() => [])));
  } else if (e?.image_url || shared) await countSaved(profileId);

  if (isInsertCard(card) && match.status === "insert") card.confidence = reading.confidence === "high" ? "medium" : "low";
  return { card, aud, fx, candidates, imageSearchEnabled: searchConfigured(), searchCapped, match, reading, setSource: list?.source ?? "none" };
}

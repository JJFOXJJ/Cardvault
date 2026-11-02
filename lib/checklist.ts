// Set checklists: find every card in a set, link the cards you already own,
// estimate values with ONE price lookup per set, and tick cards on/off.

import { askGemini } from "./ai";
import { braveWeb, type WebResult } from "./images";
import { round, usdToAud } from "./fx";
import { cardsOf, removeStoredImage, setCardsOf, setsOf } from "./supabase";

export type ChecklistEntry = { number: string | null; name: string; subset: string | null; image_url?: string | null; est_aud?: number | null };
export type SetRow = { id: string; name: string; tracking: boolean; source: string | null; source_url: string | null; total: number; priced_at: string | null };

// ---------------------------------------------------------------- helpers

export const normNum = (n: string | null | undefined) =>
  (n ?? "").toString().trim().toLowerCase().replace(/^#/, "").replace(/^0+(?=\d)/, "").replace(/\s+/g, "");
const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/#\s*\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function numericSort(a: ChecklistEntry, b: ChecklistEntry) {
  const pa = /^\d+$/.test(normNum(a.number)), pb = /^\d+$/.test(normNum(b.number));
  if (pa && pb) return Number(normNum(a.number)) - Number(normNum(b.number));
  if (pa !== pb) return pa ? -1 : 1; // plain numbers first, then inserts like "H1", "MH3"
  return normNum(a.number).localeCompare(normNum(b.number), undefined, { numeric: true });
}

function dedupe(list: ChecklistEntry[]) {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = `${normNum(c.number)}|${normName(c.name)}`;
    if (!c.name?.trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Turn pasted text ("1 Captain America", "#2 - Cyclops", "H1. Spider-Man") into entries — no AI needed. */
export function parsePasted(text: string): ChecklistEntry[] {
  const out: ChecklistEntry[] = [];
  let subset: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^#?\s*([A-Za-z]{0,4}-?\d{1,4}[a-z]?)\s*[.):\-–—]?\s+(.+)$/);
    if (m) out.push({ number: m[1], name: m[2].trim(), subset });
    else if (line.length < 60 && !/\d{3,}/.test(line)) subset = line.replace(/:$/, ""); // treat as a heading
  }
  return dedupe(out);
}

// ---------------------------------------------------------------- sources

const pokeHeaders = () => (process.env.POKEMON_TCG_API_KEY ? { "X-Api-Key": process.env.POKEMON_TCG_API_KEY } : {}) as Record<string, string>;

/** Pokémon: the official database has every card, picture and TCGplayer price. */
async function pokemonChecklist(setName: string): Promise<{ list: ChecklistEntry[]; url: string } | null> {
  const clean = setName.replace(/\b(19|20)\d{2}\b/g, "").replace(/pok[eé]mon|tcg|set/gi, "").trim();
  for (const q of [`name:"${setName.replace(/"/g, "")}"`, `name:"${clean.replace(/"/g, "")}"`, `name:"*${clean.split(/\s+/)[0]}*"`]) {
    const r = await fetch(`https://api.pokemontcg.io/v2/sets?q=${encodeURIComponent(q)}&pageSize=5`, { headers: pokeHeaders(), signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!r?.ok) continue;
    const sets = ((await r.json()) as { data?: { id: string; name: string }[] }).data ?? [];
    if (!sets.length) continue;
    const set = sets[0];
    const fx = await usdToAud();
    const list: ChecklistEntry[] = [];
    for (let page = 1; page <= 4; page++) {
      const cr = await fetch(`https://api.pokemontcg.io/v2/cards?q=set.id:${set.id}&pageSize=250&page=${page}&select=number,name,rarity,images,tcgplayer`, { headers: pokeHeaders(), signal: AbortSignal.timeout(15000) }).catch(() => null);
      if (!cr?.ok) break;
      type P = { number: string; name: string; rarity?: string; images?: { small?: string }; tcgplayer?: { prices?: Record<string, { market?: number | null }> } };
      const data = ((await cr.json()) as { data?: P[] }).data ?? [];
      for (const c of data) {
        const market = Object.values(c.tcgplayer?.prices ?? {}).map((p) => p.market).find((m) => typeof m === "number") ?? null;
        list.push({ number: c.number, name: c.name, subset: c.rarity ?? null, image_url: c.images?.small ?? null, est_aud: market != null ? round(market * fx) : null });
      }
      if (data.length < 250) break;
    }
    if (list.length) return { list: dedupe(list).sort(numericSort), url: `https://pokemontcg.io/ (${set.name})` };
  }
  return null;
}

/** Plain text of a web page, keeping one line per row/list item. */
async function pageText(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    const res = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (CardVault checklist)", Accept: "text/html" }, signal: AbortSignal.timeout(12000), redirect: "follow" });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 2_000_000);
    return html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(tr|p|li|h\d|div|br)>|<br\s*\/?>/gi, "\n")
      .replace(/<\/t[dh]>/gi, " \t ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&").replace(/&#0?39;|&apos;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n+/g, "\n")
      .trim();
  } catch {
    return null;
  }
}

const CHECKLIST_PROMPT = `You extract trading card checklists from web page text.
Return EVERY card in the named set, in order, as JSON: { "cards": [ { "number": string|null, "name": string, "subset": string|null } ] }
- "number" is the card number exactly as printed (e.g. "1", "57", "H3", "MH1"). Use null only if the set has no numbers.
- "name" is the player/character/title on that card. Keep it short.
- "subset" groups cards (e.g. "Super Heroes", "Holograms", "Rookies", "Inserts") when the page shows sections; otherwise null.
- Include insert/chase cards listed for the set, with their subset.
- Only use cards that appear in the page text. If the page is not a checklist for this set, return { "cards": [] }.`;

const PREFERRED = ["cardboardconnection.com", "tcdb.com", "sportscardchecklists.com", "beckett.com", "nonsportupdate.com", "scifihobby.com", "trading-card-checklist.com", "cardcollectorcentral.com", "psacard.com"];

/** Everything else: find a checklist page (1 search), read it, and have Gemini list the cards. */
async function webChecklist(setName: string, profileId: string): Promise<{ list: ChecklistEntry[]; url: string } | null> {
  const results = await braveWeb(`${setName} trading cards complete checklist`, profileId);
  const rank = (r: WebResult) => {
    const i = PREFERRED.findIndex((d) => r.url.includes(d));
    return (i === -1 ? 50 : i) - (/checklist/i.test(r.title + r.url) ? 20 : 0);
  };
  const candidates = [...results].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
  for (const c of candidates) {
    const text = await pageText(c.url);
    if (!text || text.length < 100) continue;
    const j = await askGemini([{ text: `SET: ${setName}\nPAGE: ${c.url}\n\nPAGE TEXT:\n${text.slice(0, 60000)}` }], CHECKLIST_PROMPT, 55000, profileId).catch(() => null);
    const raw = Array.isArray(j?.cards) ? (j!.cards as Record<string, unknown>[]) : [];
    const list = dedupe(
      raw
        .filter((x) => typeof x?.name === "string")
        .map((x) => ({ number: x.number == null ? null : String(x.number).trim() || null, name: String(x.name).trim().slice(0, 120), subset: typeof x.subset === "string" && x.subset.trim() ? x.subset.trim().slice(0, 60) : null })),
    );
    if (list.length >= 8) return { list: list.slice(0, 1500), url: c.url };
  }
  return null;
}

// ---------------------------------------------------------------- operations

/** Link cards already in the vault for this set to their checklist entries (by number, then by name). */
export async function linkExistingCards(profileId: string, set: SetRow) {
  const { data: entries } = await setCardsOf(profileId).select("id, number, name").eq("set_id", set.id);
  const { data: owned } = await cardsOf(profileId).select("id, card_number, name, subject, checklist_id").eq("set_name", set.name).neq("status", "pending");
  const byNum = new Map<string, string>(), byName = new Map<string, string>();
  for (const e of entries ?? []) {
    if (e.number && !byNum.has(normNum(e.number))) byNum.set(normNum(e.number), e.id);
    if (!byName.has(normName(e.name))) byName.set(normName(e.name), e.id);
  }
  const used = new Set((owned ?? []).map((c) => c.checklist_id).filter(Boolean));
  let linked = 0;
  for (const c of owned ?? []) {
    if (c.checklist_id) continue;
    const hit = (c.card_number && byNum.get(normNum(c.card_number))) || byName.get(normName(c.subject)) || byName.get(normName(c.name));
    if (hit && !used.has(hit)) {
      await cardsOf(profileId).update({ checklist_id: hit }).eq("id", c.id);
      used.add(hit);
      linked++;
    }
  }
  return linked;
}

/** Find and store the full checklist for a set. Replaces any previous checklist; owned cards are re-linked. */
export async function buildChecklist(profileId: string, set: SetRow, pasted?: string) {
  let found: { list: ChecklistEntry[]; url: string; source: string } | null = null;

  if (pasted?.trim()) {
    const list = parsePasted(pasted);
    if (list.length) found = { list, url: "", source: "manual" };
    else throw new Error("Couldn't read any cards from that text. Put one card per line, like “1 Captain America”.");
  } else {
    const { data: sample } = await cardsOf(profileId).select("category").eq("set_name", set.name).limit(5);
    const looksPokemon = /pok[eé]mon/i.test(set.name) || (sample ?? []).some((r) => /pok[eé]mon/i.test(r.category ?? ""));
    if (looksPokemon) {
      const p = await pokemonChecklist(set.name);
      if (p) found = { ...p, source: "pokemon" };
    }
    if (!found) {
      const w = await webChecklist(set.name, profileId);
      if (w) found = { ...w, source: "web" };
    }
  }
  if (!found) return { ok: false as const, total: 0 };

  // Replace the old checklist (owned cards keep their data; their link is cleared then re-made).
  await setCardsOf(profileId).delete().eq("set_id", set.id);
  const rows = found.list.map((c, i) => ({ set_id: set.id, sort: i, number: c.number, name: c.name, subset: c.subset, image_url: c.image_url ?? null, est_aud: c.est_aud ?? null }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await setCardsOf(profileId).insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  await setsOf(profileId)
    .update({ source: found.source, source_url: found.url || null, total: rows.length, priced_at: found.source === "pokemon" ? new Date().toISOString() : null, tracking: true })
    .eq("id", set.id);
  const linked = await linkExistingCards(profileId, set);
  if (found.source === "pokemon") await fillMissingValues(profileId, set.id);
  return { ok: true as const, total: rows.length, linked, source: found.source };
}

const PRICE_PROMPT = `You estimate typical values for every card in a trading card set, for a collector in Australia.
You get the set name, the numbered checklist, and web search results about the set's prices.
Estimate ONE raw (ungraded) near-mint copy of each card in USD. Use prices from the search results where they mention specific cards;
otherwise use your knowledge of this set (commons in older non-sport sets are often $0.25–$2; stars, rookies, holograms and inserts more).
Be conservative. Return JSON: { "values": [ { "i": <row index from the list>, "usd": number } ] } covering every row.`;

/** ONE price lookup for the whole set. Only fills estimates — never overwrites a value a card already has. */
export async function priceSet(profileId: string, set: SetRow) {
  const { data: entries } = await setCardsOf(profileId).select("id, sort, number, name, subset").eq("set_id", set.id).order("sort");
  if (!entries?.length) return { ok: false as const, priced: 0 };

  const results = await braveWeb(`${set.name} card prices value checklist`, profileId).catch(() => [] as WebResult[]);
  const snippets = results.slice(0, 8).map((r) => `- ${r.title}: ${[r.description, ...(r.extra ?? [])].join(" … ")}`).join("\n") || "(no results)";
  const listText = entries.map((e, i) => `${i}\t#${e.number ?? "-"}\t${e.name}${e.subset ? `\t[${e.subset}]` : ""}`).join("\n");
  const j = await askGemini([{ text: `SET: ${set.name}\n\nCHECKLIST (index, number, name, [subset]):\n${listText}\n\nSEARCH RESULTS:\n${snippets}` }], PRICE_PROMPT, 55000, profileId);

  const fx = await usdToAud();
  const vals = Array.isArray(j.values) ? (j.values as { i?: unknown; usd?: unknown }[]) : [];
  let priced = 0;
  for (const v of vals) {
    const i = Number(v.i), usd = Number(v.usd);
    if (!Number.isInteger(i) || !entries[i] || !isFinite(usd) || usd < 0) continue;
    await setCardsOf(profileId).update({ est_aud: round(usd * fx) }).eq("id", entries[i].id);
    priced++;
  }
  await setsOf(profileId).update({ priced_at: new Date().toISOString() }).eq("id", set.id);
  const filled = await fillMissingValues(profileId, set.id);
  return { ok: true as const, priced, filled };
}

/** Owned cards in this set that have NO value yet get the set estimate. Cards with a value are never touched. */
export async function fillMissingValues(profileId: string, setId: string) {
  const { data: entries } = await setCardsOf(profileId).select("id, est_aud").eq("set_id", setId).not("est_aud", "is", null);
  if (!entries?.length) return 0;
  const est = new Map(entries.map((e) => [e.id, Number(e.est_aud)]));
  const { data: owned } = await cardsOf(profileId).select("id, checklist_id, aud_mid").in("checklist_id", [...est.keys()]);
  let n = 0;
  for (const c of owned ?? []) {
    if (c.aud_mid != null) continue; // keep existing values
    const v = est.get(c.checklist_id);
    if (v == null) continue;
    await cardsOf(profileId)
      .update({ aud_mid: v, aud_low: v, aud_high: v, confidence: "estimate", value_notes: "Estimated from the set price lookup. Tap “Update value” for this card's own price.", priced_at: new Date().toISOString() })
      .eq("id", c.id);
    n++;
  }
  return n;
}

/** Tick (own) or untick checklist entries. Ticking creates a card; unticking removes the card it created. */
export async function setOwned(profileId: string, set: SetRow, entryIds: string[], owned: boolean, force = false) {
  const ids = [...new Set(entryIds)].filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  if (!ids.length) return { changed: 0 };
  const { data: entries } = await setCardsOf(profileId).select("id, number, name, subset, image_url, est_aud").eq("set_id", set.id).in("id", ids);
  const { data: existing } = await cardsOf(profileId).select("id, checklist_id, photo_url, image_url, name").in("checklist_id", ids);
  const have = new Map((existing ?? []).map((c) => [c.checklist_id, c]));

  if (owned) {
    // Borrow category / maker / year from cards already in this set.
    const { data: sample } = await cardsOf(profileId).select("category, manufacturer, year").eq("set_name", set.name).neq("status", "pending").limit(20);
    const mode = (k: "category" | "manufacturer" | "year") => {
      const counts = new Map<string, number>();
      for (const r of sample ?? []) if (r[k]) counts.set(r[k], (counts.get(r[k]) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    };
    const rows = (entries ?? [])
      .filter((e) => !have.has(e.id))
      .map((e) => ({
        status: "catalogued",
        name: e.number ? `${e.name} #${e.number}` : e.name,
        subject: e.name,
        set_name: set.name,
        card_number: e.number,
        variant: /holo|insert|chase|parallel|refractor|foil/i.test(e.subset ?? "") ? e.subset : null,
        category: mode("category") ?? "Other",
        manufacturer: mode("manufacturer"),
        year: mode("year"),
        image_url: e.image_url,
        quantity: 1,
        checklist_id: e.id,
        aud_mid: e.est_aud, aud_low: e.est_aud, aud_high: e.est_aud,
        confidence: e.est_aud != null ? "estimate" : null,
        value_notes: e.est_aud != null ? "Estimated from the set price lookup. Tap “Update value” for this card's own price." : null,
        priced_at: e.est_aud != null ? new Date().toISOString() : null,
        condition: "Near Mint",
      }));
    if (rows.length) {
      const { error } = await cardsOf(profileId).insert(rows);
      if (error) throw new Error(error.message);
    }
    return { changed: rows.length };
  }

  // Unticking: a scanned card (has your photo) needs confirmation first.
  const toRemove = (existing ?? []).filter((c) => ids.includes(c.checklist_id));
  const scanned = toRemove.filter((c) => c.photo_url);
  if (scanned.length && !force) return { changed: 0, needsConfirm: scanned.map((c) => c.name as string) };
  for (const c of toRemove) {
    await cardsOf(profileId).delete().eq("id", c.id);
    if (c.photo_url) {
      await removeStoredImage(c.photo_url);
      if (c.image_url && c.image_url !== c.photo_url) await removeStoredImage(c.image_url);
    }
  }
  return { changed: toRemove.length };
}

export async function getSet(profileId: string, id: string): Promise<SetRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await setsOf(profileId).select("id, name, tracking, source, source_url, total, priced_at").eq("id", id).maybeSingle();
  return (data as SetRow) ?? null;
}

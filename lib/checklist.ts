// Set checklists: find every card in a set, link the cards you already own,
// estimate values with ONE price lookup per set, and tick cards on/off.

import { askGemini } from "./ai";
import type { WebResult } from "./images";
import { round, usdToAud } from "./fx";
import { cardsOf, removeStoredImage, setCardsOf, setsOf } from "./supabase";
import { checklistSearch, imageSearch, searchAllowed, webSearch } from "./search";
import {
  countSaved, keepPicture, pictureKey, saveSharedSet, saveSharedSetPrices,
  sharedPictures, sharedSet, sharedSetPrices, correctSharedSetNames,
} from "./shared";

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
Return EVERY card in the named set, in order — big sets have hundreds of cards; do not stop early or summarise.
Use this compact JSON: { "cards": [ [number, name, subset], ... ] } where number is a string or null, name a string, subset a string or null.
- "number" is the card number exactly as printed (e.g. "1", "57", "H3", "MH1"). Use null only if the set has no numbers.
- "name" is the player/character/title on that card. Keep it short.
- "subset" groups cards (e.g. "Super Heroes", "Holograms", "Rookies", "Inserts") when the page shows sections; otherwise null.
- Include insert/chase cards listed for the set, with their subset.
- Only use cards that appear in the page text. If the page is not a checklist for this set, return { "cards": [] }.`;

const PREFERRED = ["thehobbytracker.com", "sportscardchecklist.com", "cardboardconnection.com", "tcdb.com", "sportscardchecklists.com", "beckett.com", "nonsportupdate.com", "scifihobby.com", "trading-card-checklist.com", "cardcollectorcentral.com", "psacard.com"];

/** Card numbers of the cards you own in this collection — used to spot a checklist that's obviously incomplete. */
async function ownedNumbers(profileId: string, setName: string): Promise<Set<string>> {
  return new Set((await ownedCards(profileId, setName)).map((c) => c.num));
}
type Owned = { num: string; who: string };
/** Your cards in this collection with a number: their number and player/character name. */
async function ownedCards(profileId: string, setName: string): Promise<Owned[]> {
  const { data } = await cardsOf(profileId).select("card_number, subject, name").ilike("set_name", setName.replace(/[%_]/g, "\\$&")).neq("status", "pending");
  const seen = new Set<string>();
  return (data ?? []).map((c) => ({ num: normNum(c.card_number), who: normName(c.subject || c.name) }))
    .filter((c) => c.num && !seen.has(c.num) && seen.add(c.num));
}

/** Of your cards whose number is on the list, how many have the same player at that number? (catches made-up lists) */
/** Same person/character? One name contains the other, or the same surname (letters only — numbers never count). */
export function samePerson(x: string | null | undefined, y: string | null | undefined) {
  const words = (v: string) => v.split(" ").filter((w) => /[a-z]/.test(w) && !/^\d+$/.test(w));
  const wa = words(normName(x)), wb = words(normName(y));
  if (!wa.length || !wb.length) return false;
  const ja = wa.join(" "), jb = wb.join(" ");
  return ja.includes(jb) || jb.includes(ja) || (wa.at(-1)!.length >= 3 && wa.at(-1) === wb.at(-1));
}

function agreement(list: ChecklistEntry[], owned: Owned[]) {
  const at = new Map(list.map((e) => [normNum(e.number), normName(e.name)]));
  const same = samePerson;
  const checked = owned.filter((o) => o.who && at.has(o.num));
  return { checked: checked.length, agree: checked.length ? checked.filter((o) => same(o.who, at.get(o.num)!)).length / checked.length : 0 };
}

const KNOWLEDGE_PROMPT = `You are a trading card checklist expert. From your own knowledge, list the cards in the named set, in number order:
the base set, plus its numbered insert sets if you know them (put the insert set's name in subset).
Reply with compact JSON: { "known": boolean, "total": number of base cards, "cards": [ [number, name, subset], ... ] }.
If you don't reliably know this set's checklist, reply { "known": false, "total": 0, "cards": [] }. Never invent players.`;

/**
 * Last resort when the web only has partial checklists: Gemini's own knowledge of the set (no search used),
 * accepted ONLY if it agrees with the cards you own (same players at the same numbers).
 */
async function knowledgeChecklist(setName: string, profileId: string, owned: Owned[]): Promise<ChecklistEntry[] | null> {
  if (owned.length < 5) return null; // too few of your cards to check it against
  const first = await askGemini([{ text: `SET: ${setName}` }], KNOWLEDGE_PROMPT, 50000, profileId, { maxTokens: 32000 }).catch(() => null);
  if (!first?.known) return null;
  let list = parseRows(Array.isArray(first.cards) ? (first.cards as unknown[]) : []);
  const total = Number(first.total) || 0;
  // Long sets often come back cut short — ask for the rest.
  for (let i = 0; i < 4 && total && list.filter((e) => /^\d+$/.test(e.number ?? "")).length < total - 2; i++) {
    const last = Math.max(0, ...list.map((e) => Number(normNum(e.number))).filter(Number.isFinite));
    const more = await askGemini([{ text: `SET: ${setName}\nContinue the base set checklist from card #${last + 1} to #${total}.` }], KNOWLEDGE_PROMPT, 45000, profileId, { maxTokens: 32000 }).catch(() => null);
    const rows = parseRows(Array.isArray(more?.cards) ? (more!.cards as unknown[]) : []);
    if (!rows.length) break;
    list = dedupe([...list, ...rows]);
  }
  const a = agreement(list, owned);
  return a.checked >= 5 && a.agree >= 0.9 && coverage(list, new Set(owned.map((o) => o.num))) >= 0.9 ? list.sort(numericSort) : null;
}

/** How well a checklist covers the cards you own (1 = every owned number is on it). */
function coverage(list: ChecklistEntry[], owned: Set<string>) {
  if (!owned.size) return 1;
  const nums = new Set(list.map((e) => normNum(e.number)).filter(Boolean));
  return [...owned].filter((n) => nums.has(n)).length / owned.size;
}
/** Plausible = at least as many cards as you own, and nearly all your card numbers are on it. */
export const plausible = (list: ChecklistEntry[], owned: Set<string>) =>
  list.length >= Math.max(8, owned.size) && (owned.size < 3 || coverage(list, owned) >= 0.8);

function parseRows(raw: unknown[]): ChecklistEntry[] {
  return dedupe(raw.map((x) => {
    // Compact rows ([number, name, subset]) or objects ({number, name, subset}).
    const [number, name, subset] = Array.isArray(x) ? x : [(x as Record<string, unknown>)?.number, (x as Record<string, unknown>)?.name, (x as Record<string, unknown>)?.subset];
    return {
      number: number == null ? null : String(number).trim() || null,
      name: typeof name === "string" ? name.trim().slice(0, 120) : "",
      subset: typeof subset === "string" && subset.trim() ? subset.trim().slice(0, 60) : null,
    };
  }).filter((e) => e.name));
}

/**
 * Read a numbered list straight from page text ("4 Larry Johnson", "| 4 | Larry Johnson | Hornets |").
 * No AI, so long lists are never cut short. Only trusted when it finds a real run of numbers.
 */
export function rowsFromText(text: string): ChecklistEntry[] {
  const out: ChecklistEntry[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.length > 160) continue;
    let num: string | undefined, name: string | undefined;
    if (line.includes("|")) {
      const cells = line.split("|").map((c) => c.trim()).filter(Boolean);
      const i = cells.findIndex((c) => /^#?[A-Z]{0,4}-?\d{1,4}[a-z]?$/.test(c));
      if (i !== -1 && cells[i + 1] && /[A-Za-z]/.test(cells[i + 1])) { num = cells[i].replace(/^#/, ""); name = cells[i + 1]; }
    } else {
      line = line.replace(/\s+/g, " ");
      const m = line.match(/^#?\s*([A-Z]{0,4}-?\d{1,4}[a-z]?)\s*[.):\-–—]?\s+([A-Za-z"'][^\t]{1,90})$/);
      if (m) { num = m[1]; name = m[2]; }
    }
    if (!num || !name) continue;
    if (/^(19|20)\d{2}$/.test(num)) continue; // a year, not a card number
    const k = normNum(num);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ number: num, name: name.replace(/\s+(RC|SP|\(RC\))$/i, "").trim().slice(0, 120), subset: null });
  }
  // Must look like a real checklist: plenty of rows, mostly plain numbers.
  const plain = out.filter((e) => /^\d+$/.test(e.number ?? "")).length;
  return out.length >= 20 && plain / out.length >= 0.6 ? out : [];
}

/** Ask Gemini to list the cards; long pages are read in parts so nothing is cut off. */
async function rowsFromAI(setName: string, url: string, text: string, profileId: string): Promise<ChecklistEntry[]> {
  const parts: string[] = [];
  let cur = "";
  for (const line of text.slice(0, 200000).split("\n")) {
    if (cur.length + line.length > 40000) { parts.push(cur); cur = ""; }
    cur += line + "\n";
  }
  if (cur.trim()) parts.push(cur);
  const lists = await Promise.all(parts.slice(0, 5).map((chunk, i) =>
    askGemini([{ text: `SET: ${setName}\nPAGE: ${url}${parts.length > 1 ? ` (part ${i + 1} of ${parts.length})` : ""}\n\nPAGE TEXT:\n${chunk}` }], CHECKLIST_PROMPT, 55000, profileId, { maxTokens: 32000 })
      .then((j) => parseRows(Array.isArray(j?.cards) ? (j.cards as unknown[]) : []))
      .catch(() => [] as ChecklistEntry[])));
  return dedupe(lists.flat()).slice(0, 2000);
}

/** Raw text from Tavily, or the page fetched directly, with one line per row. */
const cleanRaw = (raw?: string) => (raw && raw.length > 100 ? raw.replace(/\u00a0/g, " ") : null);

export type Tried = { site: string; cards: number; note: string };

/**
 * Everything else: find checklist pages and read them.
 * 1 search; if nothing covers the cards you own, 1 more search limited to full-checklist sites.
 * Each page is read as a numbered list first (no AI), then by Gemini; the most complete result wins.
 */
async function webChecklist(setName: string, profileId: string): Promise<{ list: ChecklistEntry[]; url: string; complete: boolean; tried: Tried[]; source?: string } | null> {
  const owned = await ownedNumbers(profileId, setName);
  const tried: Tried[] = [];
  const seen = new Set<string>();
  let best: { list: ChecklistEntry[]; url: string; score: number } | null = null;
  const lists: { list: ChecklistEntry[]; url: string }[] = [];
  const started = Date.now();

  const rank = (r: WebResult) => {
    const i = PREFERRED.findIndex((d) => r.url.includes(d));
    return (i === -1 ? 50 : i) - (/checklist/i.test(r.title + r.url) ? 20 : 0) + (/ebay\.|facebook\.|reddit\./i.test(r.url) ? 100 : 0);
  };

  async function readPages(results: WebResult[], max: number) {
    for (const c of [...results].sort((a, b) => rank(a) - rank(b)).filter((r) => !seen.has(r.url)).slice(0, max)) {
      if (Date.now() - started > 80_000) break; // stay inside the request time limit
      seen.add(c.url);
      const site = (() => { try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return c.url; } })();
      const text = cleanRaw(c.raw) ?? (await pageText(c.url));
      if (!text || text.length < 100) { tried.push({ site, cards: 0, note: "couldn't read the page" }); continue; }
      const fromText = rowsFromText(text);
      const fromAI = plausible(fromText, owned) && fromText.length >= 50 ? [] : await rowsFromAI(setName, c.url, text, profileId);
      // Prefer whichever reading covers your cards; then the longer one.
      const pick = [fromAI, fromText].sort((a, b) => Number(plausible(b, owned)) - Number(plausible(a, owned)) || b.length - a.length)[0];
      if (pick.length < 8) { tried.push({ site, cards: pick.length, note: "no checklist on this page" }); continue; }
      lists.push({ list: pick, url: c.url });
      const ok = plausible(pick, owned);
      tried.push({ site, cards: pick.length, note: ok ? "used" : coverage(pick, owned) < 0.8 ? "missing most of your cards" : "too few cards" });
      const score = (ok ? 1e7 : 0) + coverage(pick, owned) * 10000 + pick.length;
      if (!best || score > best.score) best = { list: pick, url: c.url, score };
      if (ok) return true;
    }
    return false;
  }

  if (await readPages(await checklistSearch(`${setName} trading cards complete checklist`, profileId), 4)) {
    return { list: best!.list, url: best!.url, complete: true, tried };
  }
  // Second (and last) try: only sites that publish whole checklists on one page.
  if (await readPages(await checklistSearch(`${setName} base set checklist`, profileId, ["thehobbytracker.com", "sportscardchecklist.com", "tcdb.com"]), 3)) {
    return { list: best!.list, url: best!.url, complete: true, tried };
  }
  // Several partial pages (e.g. a price guide showing 150 cards a page) can add up to the whole set.
  const mine = await ownedCards(profileId, setName);
  if (lists.length > 1) {
    const sorted = [...lists].sort((a, b) => b.list.length - a.list.length);
    const merged = dedupe(sorted.flatMap((l) => l.list).filter((e, i, all) => !e.number || all.findIndex((x) => normNum(x.number) === normNum(e.number)) === i)).sort(numericSort);
    const ag = agreement(merged, mine);
    if (plausible(merged, owned) && (ag.checked < 5 || ag.agree >= 0.75)) {
      tried.push({ site: "pages combined", cards: merged.length, note: "used" });
      return { list: merged, url: sorted[0].url, complete: true, tried };
    }
  }
  // Finally: the AI's own knowledge of the set, checked against your cards (no search).
  const known = await knowledgeChecklist(setName, profileId, mine);
  if (known) {
    tried.push({ site: "AI knowledge (checked against your cards)", cards: known.length, note: "used" });
    return { list: known, url: "", complete: true, tried, source: "ai" };
  }
  tried.push({ site: "AI knowledge", cards: 0, note: mine.length < 5 ? "not enough of your cards to check it" : "didn't match your cards" });
  console.warn("Checklist search for", setName, "found no complete list:", JSON.stringify(tried));
  const b = best as { list: ChecklistEntry[]; url: string; score: number } | null;
  return b ? { list: b.list, url: b.url, complete: false, tried } : tried.length ? { list: [], url: "", complete: false, tried } : null;
}

// ---------------------------------------------------------------- operations

/**
 * Link cards already in the vault to their checklist entries. Your scanned cards are trusted:
 *  1. same number AND same player → linked
 *  2. a scanned card whose number is on the list but with a different player: the checklist is wrong there,
 *     so that entry is corrected to your card's player → linked (scanned numbers are trusted)
 *  3. otherwise (not scanned, or the number isn't on the list) the player's name elsewhere → linked there
 *  4. anything else stays unlinked (shown on the set page)
 * `reset` first clears this set's links, so matching can be redone without a new search.
 */
export async function linkExistingCards(profileId: string, set: SetRow, opts: { reset?: boolean } = {}) {
  const { data: entries } = await setCardsOf(profileId).select("id, number, name").eq("set_id", set.id);
  const ids = (entries ?? []).map((e) => e.id);
  if (opts.reset && ids.length) {
    for (let i = 0; i < ids.length; i += 300) await cardsOf(profileId).update({ checklist_id: null }).in("checklist_id", ids.slice(i, i + 300));
  }
  const { data: owned } = await cardsOf(profileId).select("id, card_number, name, subject, checklist_id, photo_url, confidence")
    .ilike("set_name", set.name.replace(/[%_]/g, "\\$&")).neq("status", "pending");
  const shifted = set.source !== "manual" && set.source !== "pokemon" ? await fixShiftedNames(profileId, entries ?? [], owned ?? []) : 0;
  const byNum = new Map<string, { id: string; name: string }>(), byName = new Map<string, string>();
  for (const e of entries ?? []) {
    if (e.number && !byNum.has(normNum(e.number))) byNum.set(normNum(e.number), e);
    if (!byName.has(normName(e.name))) byName.set(normName(e.name), e.id);
  }
  const used = new Set((owned ?? []).map((c) => c.checklist_id).filter(Boolean));
  let linked = 0, corrected = 0;
  const fixes: { number: string; name: string }[] = [];
  // Cards whose number AND name agree go first, so they can't be pushed aside by a misnumbered card.
  const cards = [...(owned ?? [])].filter((c) => !c.checklist_id);
  const exact = (c: (typeof cards)[number]) => {
    const e = c.card_number ? byNum.get(normNum(c.card_number)) : undefined;
    return !!e && samePerson(c.subject || c.name, e.name);
  };
  cards.sort((a, b) => Number(exact(b)) - Number(exact(a)));
  const canCorrect = set.source !== "manual" && set.source !== "pokemon";
  for (const c of cards) {
    const who = c.subject || c.name;
    const atNum = c.card_number ? byNum.get(normNum(c.card_number)) : undefined;
    const scanned = !!c.photo_url && c.confidence !== "low" && !!c.subject?.trim();
    let hit: string | undefined;
    if (atNum && !used.has(atNum.id) && (samePerson(who, atNum.name) || !normName(who))) hit = atNum.id;
    else if (atNum && !used.has(atNum.id) && scanned && canCorrect) {
      // A scanned card's number is trusted: the checklist has the wrong player at this number, so fix it.
      await setCardsOf(profileId).update({ name: c.subject!.trim() }).eq("id", atNum.id);
      fixes.push({ number: c.card_number!, name: c.subject!.trim() });
      corrected++;
      hit = atNum.id;
    } else {
      // Not scanned, or its number isn't on the list (e.g. misread): find the player by name.
      const named = byName.get(normName(c.subject)) ?? byName.get(normName(c.name));
      if (named && !used.has(named)) hit = named;
    }
    if (hit) {
      await cardsOf(profileId).update({ checklist_id: hit }).eq("id", c.id);
      used.add(hit);
      linked++;
    }
  }
  // Only share corrections when they're the exception — a list that's wrong everywhere isn't fixed this way.
  if (fixes.length && fixes.length <= Math.max(3, (owned ?? []).length * 0.25)) await correctSharedSetNames(set.name, fixes);
  return { linked, corrected, shifted, owned: (owned ?? []).length };
}

/**
 * Some lists have every name one or two places off (e.g. card #6's player listed at #5). If your scanned cards
 * consistently match the name a fixed number of places away, move every name back into place. Returns the shift.
 */
async function fixShiftedNames(profileId: string, entries: { id: string; number: string | null; name: string }[], owned: { card_number: string | null; subject: string | null; photo_url: string | null; confidence: string | null }[]) {
  const at = new Map<number, { id: string; name: string }>();
  for (const e of entries) if (/^\d+$/.test(normNum(e.number))) at.set(Number(normNum(e.number)), e);
  const scanned = owned.filter((c) => c.photo_url && c.confidence !== "low" && c.subject && /^\d+$/.test(normNum(c.card_number)));
  const wrong = scanned.filter((c) => !samePerson(c.subject, at.get(Number(normNum(c.card_number)))?.name));
  if (wrong.length < 3) return 0;
  let best = 0, bestHits = 0;
  for (const k of [-3, -2, -1, 1, 2, 3]) {
    const hits = wrong.filter((c) => samePerson(c.subject, at.get(Number(normNum(c.card_number)) + k)?.name)).length;
    if (hits > bestHits) { best = k; bestHits = hits; }
  }
  if (!best || bestHits < Math.max(3, wrong.length * 0.6)) return 0;
  // Name for #n comes from the entry k places away.
  const updates = [...at.entries()].map(([n, e]) => ({ id: e.id, name: at.get(n + best)?.name })).filter((u) => u.name);
  for (const u of updates) await setCardsOf(profileId).update({ name: u.name }).eq("id", u.id);
  for (const e of entries) { const u = updates.find((x) => x.id === e.id); if (u) e.name = u.name!; }
  return best;
}

type Found = { list: ChecklistEntry[]; url: string; source: string; shared?: boolean; pricedAt?: string | null; incomplete?: boolean };

async function looksPokemon(profileId: string, setName: string) {
  if (/pok[eé]mon/i.test(setName)) return true;
  const { data: sample } = await cardsOf(profileId).select("category").eq("set_name", setName).limit(5);
  return (sample ?? []).some((r) => /pok[eé]mon/i.test(r.category ?? ""));
}

/** The shared library's checklist for this set, if anyone found it already (free). Pokémon is left to the official database. */
async function libraryChecklist(setName: string): Promise<Found | null> {
  const shared = await sharedSet(setName).catch(() => null);
  if (!shared || shared.source === "pokemon") return null;
  const prices = sharedSetPrices(shared);
  return { list: shared.entries.map((e) => ({ ...e, est_aud: prices ? prices.find(e) : null })), url: shared.source_url ?? "", source: shared.source ?? "web", shared: true, pricedAt: prices?.pricedAt ?? null };
}

/** What the last web lookup tried (shown to the owner when a checklist can't be completed). */
let lastTried: Tried[] = [];

/**
 * Find a set's checklist: shared library (free) → Pokémon database (free) → web (1 search, only if `search`).
 * A web find is saved to the library, so tracking or previewing it again costs nothing.
 */
export async function findChecklist(profileId: string, setName: string, opts: { search: boolean; force?: boolean }): Promise<(Found & { needsSearch?: false }) | { needsSearch: true } | null> {
  lastTried = [];
  // The library's list is skipped when asked to look again, or when it clearly doesn't cover the cards you own.
  const lib = opts.force ? null : await libraryChecklist(setName);
  if (lib && plausible(lib.list, await ownedNumbers(profileId, setName))) { await countSaved(profileId, lib.source === "manual" ? 0 : 1); return lib; }
  if (await looksPokemon(profileId, setName)) {
    const p = await pokemonChecklist(setName);
    if (p) return { ...p, source: "pokemon" };
  }
  if (!opts.search) return lib ?? { needsSearch: true };
  const w = await webChecklist(setName, profileId);
  lastTried = w?.tried ?? [];
  // Keep whichever list is more complete: the new find or the library's.
  if (!w || !w.list.length) return lib;
  if (lib && lib.list.length >= w.list.length) return lib;
  await saveSharedSet(setName, w.source ?? "web", w.url || null, w.list, null, { replaceSmaller: true });
  return { list: w.list, url: w.url, source: w.source ?? "web", shared: false, incomplete: !w.complete };
}

/** Find and store the full checklist for a set. Replaces any previous checklist; owned cards are re-linked. */
export async function buildChecklist(profileId: string, set: SetRow, pasted?: string, opts: { force?: boolean } = {}) {
  let found: Found | null = null;

  if (pasted?.trim()) {
    const list = parsePasted(pasted);
    if (list.length) found = { list, url: "", source: "manual" };
    else throw new Error("Couldn't read any cards from that text. Put one card per line, like “1 Captain America”.");
  } else {
    const f = await findChecklist(profileId, set.name, { search: true, force: opts.force });
    if (f && !f.needsSearch) found = f;
  }
  if (!found) return { ok: false as const, total: 0, tried: lastTried };

  // Replace the old checklist (owned cards keep their data; their link is cleared then re-made).
  await setCardsOf(profileId).delete().eq("set_id", set.id);
  const rows = found.list.map((c, i) => ({ set_id: set.id, sort: i, number: c.number, name: c.name, subset: c.subset, image_url: c.image_url ?? null, est_aud: c.est_aud ?? null }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await setCardsOf(profileId).insert(rows.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  const pricedAt = found.pricedAt ?? (found.source === "pokemon" ? new Date().toISOString() : null);
  await setsOf(profileId)
    .update({ source: found.source, source_url: found.url || null, total: rows.length, priced_at: pricedAt, tracking: true })
    .eq("id", set.id);
  const { linked, corrected, owned: ownedCount } = await linkExistingCards(profileId, { ...set, source: found.source });
  if (pricedAt) await fillMissingValues(profileId, set.id);
  if (!found.shared && found.source === "manual") await saveSharedSet(set.name, found.source, found.url || null, found.list, null, { replaceSmaller: true });
  // Warn when the list still doesn't cover the cards you own (e.g. the page only had part of the set).
  const owned = await ownedNumbers(profileId, set.name);
  // A list that needed many corrections from your cards is probably wrong overall.
  const unreliable = corrected > Math.max(3, ownedCount * 0.25);
  const incomplete = found.source !== "manual" && (!plausible(found.list, owned) || unreliable);
  return { ok: true as const, total: rows.length, linked, corrected, unreliable, source: found.source, shared: !!found.shared, incomplete, owned: owned.size, tried: lastTried };
}

const PRICE_PROMPT = `You estimate typical values for every card in a trading card set, for a collector in Australia.
You get the set name, the numbered checklist, and web search results about the set's prices.
Estimate ONE raw (ungraded) near-mint copy of each card in USD. Use prices from the search results where they mention specific cards;
otherwise use your knowledge of this set (commons in older non-sport sets are often $0.25–$2; stars, rookies, holograms and inserts more).
Be conservative. Return JSON: { "values": [ { "i": <row index from the list>, "usd": number } ] } covering every row.`;

/**
 * ONE price lookup for the whole set — or none, if anyone priced this set in the last 30 days.
 * Only fills estimates — never overwrites a value a card already has.
 */
export async function priceSet(profileId: string, set: SetRow, opts: { force?: boolean } = {}) {
  const { data: entries } = await setCardsOf(profileId).select("id, sort, number, name, subset").eq("set_id", set.id).order("sort");
  if (!entries?.length) return { ok: false as const, priced: 0 };

  if (!opts.force) {
    const prices = sharedSetPrices(await sharedSet(set.name).catch(() => null));
    if (prices) {
      let priced = 0;
      for (const e of entries) {
        const v = prices.find(e);
        if (v == null) continue;
        await setCardsOf(profileId).update({ est_aud: v }).eq("id", e.id);
        priced++;
      }
      if (priced >= entries.length / 2) {
        await setsOf(profileId).update({ priced_at: prices.pricedAt }).eq("id", set.id);
        await countSaved(profileId);
        const filled = await fillMissingValues(profileId, set.id);
        return { ok: true as const, priced, filled, shared: true };
      }
    }
  }

  const { results } = await webSearch(`${set.name} card prices value checklist`, profileId).catch(() => ({ results: [] as WebResult[] }));
  const snippets = results.slice(0, 8).map((r) => `- ${r.title}: ${[r.description, ...(r.extra ?? [])].join(" … ")}`).join("\n") || "(no results)";
  const listText = entries.map((e, i) => `${i}\t#${e.number ?? "-"}\t${e.name}${e.subset ? `\t[${e.subset}]` : ""}`).join("\n");
  const j = await askGemini([{ text: `SET: ${set.name}\n\nCHECKLIST (index, number, name, [subset]):\n${listText}\n\nSEARCH RESULTS:\n${snippets}` }], PRICE_PROMPT, 55000, profileId);

  const fx = await usdToAud();
  const vals = Array.isArray(j.values) ? (j.values as { i?: unknown; usd?: unknown }[]) : [];
  let priced = 0;
  const forLibrary: { number: string | null; name: string; est_aud: number }[] = [];
  for (const v of vals) {
    const i = Number(v.i), usd = Number(v.usd);
    if (!Number.isInteger(i) || !entries[i] || !isFinite(usd) || usd < 0) continue;
    const est = round(usd * fx);
    await setCardsOf(profileId).update({ est_aud: est }).eq("id", entries[i].id);
    if (est != null) forLibrary.push({ number: entries[i].number, name: entries[i].name, est_aud: est });
    priced++;
  }
  await setsOf(profileId).update({ priced_at: new Date().toISOString() }).eq("id", set.id);
  if (priced) {
    // Sets tracked before the library existed get added to it now.
    if (set.source && set.source !== "pokemon" && !(await sharedSet(set.name).catch(() => null))) {
      const est = new Map(forLibrary.map((f) => [`${f.number}|${f.name}`, f.est_aud]));
      await saveSharedSet(set.name, set.source, set.source_url, entries.map((e) => ({ number: e.number, name: e.name, subset: e.subset, est_aud: est.get(`${e.number}|${e.name}`) ?? null })), new Date().toISOString());
    } else await saveSharedSetPrices(set.name, forLibrary);
  }
  const filled = await fillMissingValues(profileId, set.id);
  return { ok: true as const, priced, filled, shared: false };
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
    // Pictures someone already found for these cards are free to use.
    const variantOf = (e: { subset: string | null }) => (/holo|insert|chase|parallel|refractor|foil/i.test(e.subset ?? "") ? e.subset : null);
    const pics = await sharedPictures((entries ?? []).filter((e) => !e.image_url).map((e) => pictureKey({ set_name: set.name, card_number: e.number, subject: e.name, variant: variantOf(e) }))).catch(() => new Map<string, string>());
    const rows = (entries ?? [])
      .filter((e) => !have.has(e.id))
      .map((e) => ({
        status: "catalogued",
        name: e.number ? `${e.name} #${e.number}` : e.name,
        subject: e.name,
        set_name: set.name,
        card_number: e.number,
        variant: variantOf(e),
        category: mode("category") ?? "Other",
        manufacturer: mode("manufacturer"),
        year: mode("year"),
        image_url: e.image_url ?? pics.get(pictureKey({ set_name: set.name, card_number: e.number, subject: e.name, variant: variantOf(e) }) ?? "") ?? null,
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
      const fromLibrary = rows.filter((r) => r.image_url && pics.size && [...pics.values()].includes(r.image_url)).length;
      if (fromLibrary) await countSaved(profileId, fromLibrary);
    }
    return { changed: rows.length };
  }

  // Unticking: a scanned card (has your photo) needs confirmation first.
  const toRemove = (existing ?? []).filter((c) => ids.includes(c.checklist_id));
  const scanned = toRemove.filter((c) => c.photo_url);
  if (scanned.length && !force) return { changed: 0, needsConfirm: scanned.map((c) => c.name as string) };
  for (const c of toRemove) {
    await cardsOf(profileId).delete().eq("id", c.id);
    // Remove pictures we stored (photos, auto-found pictures). Outside links (e.g. Pokémon) are left alone.
    if (c.photo_url) await removeStoredImage(c.photo_url);
    if (c.image_url && c.image_url !== c.photo_url) await removeStoredImage(c.image_url);
  }
  return { changed: toRemove.length };
}

export async function getSet(profileId: string, id: string): Promise<SetRow | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await setsOf(profileId).select("id, name, tracking, source, source_url, total, priced_at").eq("id", id).maybeSingle();
  return (data as SetRow) ?? null;
}

/**
 * Find a picture for owned cards in this set that don't have one.
 * Library pictures are used first (free); otherwise 1 picture search per card, and what's found goes into the library.
 * Works through at most `max` searches per call so each request stays short; call again for the rest.
 */
export async function findPictures(profileId: string, set: SetRow, entryIds?: string[], max = 4) {
  const { data: entries } = await setCardsOf(profileId).select("id, number, name, subset").eq("set_id", set.id);
  const entry = new Map((entries ?? []).map((e) => [e.id, e]));
  const wanted = entryIds?.length ? entryIds.filter((id) => entry.has(id)) : [...entry.keys()];
  if (!wanted.length) return { done: 0, remaining: 0, capped: false, tried: [] as string[] };

  const { data: owned } = await cardsOf(profileId).select("id, checklist_id, image_url, photo_url, variant").in("checklist_id", wanted.slice(0, 500));
  const todo = (owned ?? []).filter((c) => !c.image_url && !c.photo_url);
  const keyOf = (c: { checklist_id: string; variant: string | null }) => {
    const e = entry.get(c.checklist_id)!;
    return pictureKey({ set_name: set.name, card_number: e.number, subject: e.name, variant: c.variant });
  };
  let done = 0, capped = false, searched = 0;
  const tried: string[] = [];

  // 1. Free: pictures already in the shared library.
  const lib = await sharedPictures(todo.map(keyOf)).catch(() => new Map<string, string>());
  const rest: typeof todo = [];
  for (const c of todo) {
    const url = lib.get(keyOf(c) ?? "");
    if (url) {
      await cardsOf(profileId).update({ image_url: url, image_source: null }).eq("id", c.id);
      tried.push(c.checklist_id);
      done++;
    } else rest.push(c);
  }
  if (done) await countSaved(profileId, done);

  // 2. Search for the rest.
  for (const c of rest.slice(0, max)) {
    if (!(await searchAllowed())) { capped = true; break; }
    tried.push(c.checklist_id);
    searched++;
    const e = entry.get(c.checklist_id)!;
    const query = `${set.name} ${e.number ? `#${e.number} ` : ""}${e.name} card`;
    const found = await imageSearch(query, 4, profileId).catch(() => []);
    for (const cand of found) {
      let url: string | null = null;
      for (const src of [cand.url, cand.thumb]) {
        try { url = await keepPicture(src, { set_name: set.name, card_number: e.number, subject: e.name, variant: c.variant }, cand.source); break; } catch { /* try the next source */ }
      }
      if (url) {
        await cardsOf(profileId).update({ image_url: url, image_source: cand.source ?? null }).eq("id", c.id);
        done++;
        break;
      }
    }
  }
  return { done, remaining: capped ? rest.length : Math.max(0, rest.length - searched), capped, tried };
}

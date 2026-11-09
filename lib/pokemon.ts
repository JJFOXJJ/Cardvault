// Pokémon set catalogue — free sources only.
//  • pokemontcg.io (free key optional): every set, every card, pictures and TCGplayer prices.
//    Its owners plan to retire it in favour of a paid successor (Scrydex), so:
//  • TCGdex (free, open source, no key) is the backup, and
//  • every set an admin adds is copied into the shared library, so it keeps working whatever happens.

import { round, usdToAud } from "./fx";
import type { ChecklistEntry } from "./checklist";

export type PokemonSet = {
  id: string; name: string; series: string | null; releaseDate: string | null; year: string | null;
  total: number | null; logo: string | null; symbol: string | null; source: "pokemontcg" | "tcgdex";
};

const PTCG = "https://api.pokemontcg.io/v2";
const TCGDEX = "https://api.tcgdex.net/v2/en";
const headers = () => (process.env.POKEMON_TCG_API_KEY ? { "X-Api-Key": process.env.POKEMON_TCG_API_KEY } : {}) as Record<string, string>;
const getJson = async <T>(url: string, ms = 20000): Promise<T | null> => {
  try {
    const r = await fetch(url, { headers: url.startsWith(PTCG) ? headers() : {}, signal: AbortSignal.timeout(ms) });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
};

let cache: { at: number; sets: PokemonSet[] } | null = null;

/** Every Pokémon set, newest first. Cached for 6 hours. */
export async function listPokemonSets(): Promise<{ sets: PokemonSet[]; source: string | null }> {
  if (cache && Date.now() - cache.at < 6 * 3_600_000) return { sets: cache.sets, source: cache.sets[0]?.source ?? null };
  type P = { id: string; name: string; series?: string; releaseDate?: string; total?: number; printedTotal?: number; images?: { logo?: string; symbol?: string } };
  const sets: PokemonSet[] = [];
  for (let page = 1; page <= 4; page++) {
    const d = await getJson<{ data?: P[]; totalCount?: number }>(`${PTCG}/sets?orderBy=-releaseDate&pageSize=250&page=${page}`);
    if (!d?.data) break;
    for (const s of d.data) {
      const date = s.releaseDate ? s.releaseDate.replace(/\//g, "-") : null;
      sets.push({ id: s.id, name: s.name, series: s.series ?? null, releaseDate: date, year: date?.slice(0, 4) ?? null, total: s.total ?? s.printedTotal ?? null, logo: s.images?.logo ?? null, symbol: s.images?.symbol ?? null, source: "pokemontcg" });
    }
    if (d.data.length < 250) break;
  }
  if (!sets.length) {
    // Backup: TCGdex. Its list has no dates, so newest-first uses the order it returns (oldest first) reversed.
    type T = { id: string; name: string; logo?: string; symbol?: string; cardCount?: { total?: number; official?: number } };
    const d = await getJson<T[]>(`${TCGDEX}/sets`);
    for (const s of [...(d ?? [])].reverse()) {
      sets.push({ id: s.id, name: s.name, series: null, releaseDate: null, year: null, total: s.cardCount?.total ?? s.cardCount?.official ?? null, logo: s.logo ? `${s.logo}.png` : null, symbol: s.symbol ? `${s.symbol}.png` : null, source: "tcgdex" });
    }
  }
  if (sets.length) cache = { at: Date.now(), sets };
  return { sets, source: sets[0]?.source ?? null };
}

/** A Pokémon set's full checklist: number, name, rarity (as subset), official picture and a market price (AUD). */
export async function pokemonSetChecklist(id: string, source: "pokemontcg" | "tcgdex" = "pokemontcg"): Promise<{ name: string; year: string | null; series: string | null; entries: ChecklistEntry[]; url: string } | null> {
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(id)) return null;
  if (source === "pokemontcg") {
    type S = { data?: { id: string; name: string; series?: string; releaseDate?: string } };
    const set = await getJson<S>(`${PTCG}/sets/${id}`);
    if (set?.data) {
      type C = { number: string; name: string; rarity?: string; images?: { small?: string; large?: string }; tcgplayer?: { prices?: Record<string, { market?: number | null }> } };
      const fx = await usdToAud();
      const entries: ChecklistEntry[] = [];
      for (let page = 1; page <= 6; page++) {
        const d = await getJson<{ data?: C[] }>(`${PTCG}/cards?q=set.id:${id}&pageSize=250&page=${page}&select=number,name,rarity,images,tcgplayer`, 30000);
        if (!d?.data) break;
        for (const c of d.data) {
          const market = Object.values(c.tcgplayer?.prices ?? {}).map((p) => p.market).find((m) => typeof m === "number") ?? null;
          entries.push({ number: c.number, name: c.name, subset: c.rarity ?? null, image_url: c.images?.large ?? c.images?.small ?? null, est_aud: market != null ? round(market * fx) : null });
        }
        if (d.data.length < 250) break;
      }
      if (entries.length) {
        entries.sort((a, b) => (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true }));
        const date = set.data.releaseDate?.replace(/\//g, "-") ?? null;
        return { name: set.data.name, year: date?.slice(0, 4) ?? null, series: set.data.series ?? null, entries, url: `https://pokemontcg.io/ (set ${id})` };
      }
    }
  }
  // Backup (or chosen): TCGdex. Same set ids for most sets.
  type T = { id: string; name: string; releaseDate?: string; serie?: { name?: string }; cards?: { localId: string; name: string; image?: string }[] };
  const t = await getJson<T>(`${TCGDEX}/sets/${id}`);
  if (!t?.cards?.length) return null;
  const entries: ChecklistEntry[] = t.cards.map((c) => ({ number: c.localId, name: c.name, subset: null, image_url: c.image ? `${c.image}/high.webp` : null, est_aud: null }));
  entries.sort((a, b) => (a.number ?? "").localeCompare(b.number ?? "", undefined, { numeric: true }));
  return { name: t.name, year: t.releaseDate?.slice(0, 4) ?? null, series: t.serie?.name ?? null, entries, url: `https://tcgdex.dev/ (set ${id})` };
}

/** Name used on the approved list: "Pokémon Jungle", "Pokémon Scarlet & Violet—151". */
export const pokemonDisplayName = (name: string) => (/^pok[eé]mon\b/i.test(name.trim()) ? name.trim() : `Pokémon ${name.trim()}`);

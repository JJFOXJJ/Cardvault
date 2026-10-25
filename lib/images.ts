export type ImageCandidate = {
  url: string;      // full-size image to store
  thumb: string;    // safe-to-display preview
  source?: string;  // page it was found on
  title?: string;
  origin: "pokemontcg" | "brave";
};

export type WebResult = { title: string; url: string; description: string; extra?: string[]; age?: string };

/** Web results (with extra snippets) used to price a card. */
export async function braveWeb(query: string): Promise<WebResult[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key || !query.trim()) return [];
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=10&extra_snippets=true&safesearch=strict`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error("Brave web search failed", res.status, await res.text().catch(() => ""));
    return [];
  }
  type R = { title?: string; url?: string; description?: string; extra_snippets?: string[]; age?: string };
  const data = (await res.json()) as { web?: { results?: R[] } };
  const strip = (s?: string) => (s ?? "").replace(/<[^>]+>/g, "");
  return (data.web?.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({
      title: strip(r.title),
      url: r.url!,
      description: strip(r.description),
      extra: r.extra_snippets?.map(strip).slice(0, 4),
      age: r.age,
    }));
}

/** Clean card images from Brave's image search. */
export async function braveImages(query: string, count = 8): Promise<ImageCandidate[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key || !query.trim()) return [];
  const url = `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=20&safesearch=strict`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    console.error("Brave image search failed", res.status, await res.text().catch(() => ""));
    return [];
  }
  type BraveImage = { url?: string; title?: string; thumbnail?: { src?: string }; properties?: { url?: string } };
  const data = (await res.json()) as { results?: BraveImage[] };
  const seen = new Set<string>();
  const out: ImageCandidate[] = [];
  for (const r of data.results ?? []) {
    const full = r.properties?.url;
    const thumb = r.thumbnail?.src;
    if (!full?.startsWith("https://") || !thumb || seen.has(full)) continue;
    seen.add(full);
    out.push({ url: full, thumb, source: r.url, title: r.title, origin: "brave" });
    if (out.length >= count) break;
  }
  return out;
}

export type PokemonMatch = ImageCandidate & {
  set?: string;
  number?: string;
  marketUsd?: number | null;
};

/** Official Pokémon card scans and TCGplayer prices from the Pokémon TCG API. */
export async function pokemonImages(name: string, number?: string | null, set?: string | null): Promise<PokemonMatch[]> {
  const esc = (s: string) => s.replace(/"/g, "");
  const parts = [`name:"${esc(name)}"`];
  if (number) parts.push(`number:${esc(number.split("/")[0].trim())}`);
  if (set) parts.push(`set.name:"${esc(set)}"`);

  const headers: Record<string, string> = {};
  if (process.env.POKEMON_TCG_API_KEY) headers["X-Api-Key"] = process.env.POKEMON_TCG_API_KEY;

  type PCard = {
    name: string; number: string;
    set?: { name?: string };
    images?: { small?: string; large?: string };
    tcgplayer?: { url?: string; prices?: Record<string, { market?: number | null }> };
  };

  // Try the most specific query first, then relax it.
  for (let n = parts.length; n >= 1; n--) {
    const q = encodeURIComponent(parts.slice(0, n).join(" "));
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards?q=${q}&pageSize=8`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { data?: PCard[] };
      if (!data.data?.length) continue;
      return data.data
        .filter((c) => c.images?.large)
        .map((c) => {
          const prices = Object.values(c.tcgplayer?.prices ?? {});
          const market = prices.map((p) => p.market).find((m) => typeof m === "number") ?? null;
          return {
            url: c.images!.large!,
            thumb: c.images!.small ?? c.images!.large!,
            source: c.tcgplayer?.url,
            title: `${c.name} · ${c.set?.name ?? ""} #${c.number}`,
            origin: "pokemontcg" as const,
            set: c.set?.name,
            number: c.number,
            marketUsd: market,
          };
        });
    } catch {
      /* try a looser query */
    }
  }
  return [];
}

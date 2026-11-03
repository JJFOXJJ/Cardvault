// One place for web and picture searches.
// Order: Tavily first (1,000 free a month, and one search also returns pictures), then Brave
// ($5 free credit a month). Each service stops by itself when its monthly limit is reached.

import { braveImages, braveWeb, type ImageCandidate, type WebResult } from "./images";
import { braveAllowed, hasBrave, hasTavily, recordUsage, tavilyAllowed } from "./usage";

export type SearchResult = { results: WebResult[]; images: ImageCandidate[]; provider: "tavily" | "brave" | null };

const BAD_IMAGE = /\.svg(\?|$)|logo|icon|sprite|avatar|banner|placeholder|blank\.|pixel|favicon|\/ads?\//i;

async function tavily(query: string, opts: { images: boolean; max: number; raw?: boolean; domains?: string[] }, profileId?: string): Promise<SearchResult | null> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key || !query.trim()) return null;
  if (!(await tavilyAllowed())) return null;
  let res: Response;
  try {
    res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        query, search_depth: "basic", max_results: opts.max, include_images: opts.images, include_answer: false,
        ...(opts.raw ? { include_raw_content: "text" } : {}),
        ...(opts.domains?.length ? { include_domains: opts.domains } : {}),
      }),
      signal: AbortSignal.timeout(opts.raw ? 25000 : 12000),
    });
  } catch (e) {
    console.error("Tavily search failed", e);
    return null;
  }
  if (res.status !== 401 && res.status !== 403) await recordUsage("tavily", profileId);
  if (!res.ok) {
    console.error("Tavily search failed", res.status, await res.text().catch(() => ""));
    return null; // fall back to Brave
  }
  type T = { results?: { title?: string; url?: string; content?: string; published_date?: string; raw_content?: string | null }[]; images?: (string | { url?: string })[] };
  const data = (await res.json().catch(() => ({}))) as T;
  const results: WebResult[] = (data.results ?? [])
    .filter((r) => r.url)
    .map((r) => ({ title: r.title ?? r.url!, url: r.url!, description: (r.content ?? "").slice(0, 600), age: r.published_date, raw: r.raw_content ?? undefined }));
  const seen = new Set<string>();
  const images: ImageCandidate[] = [];
  for (const im of data.images ?? []) {
    const url = typeof im === "string" ? im : im?.url;
    if (!url?.startsWith("https://") || BAD_IMAGE.test(url) || seen.has(url)) continue;
    seen.add(url);
    images.push({ url, thumb: url, origin: "web" });
  }
  return { results, images, provider: "tavily" };
}

/** Web results for prices / checklists. With `images`, Tavily also returns pictures at no extra cost. */
export async function webSearch(query: string, profileId?: string, opts: { images?: boolean } = {}): Promise<SearchResult> {
  const t = await tavily(query, { images: !!opts.images, max: 10 }, profileId);
  if (t && t.results.length) return t;
  const results = await braveWeb(query, profileId).catch(() => [] as WebResult[]);
  if (results.length || !t) return { results, images: t?.images ?? [], provider: results.length ? "brave" : null };
  return t;
}

/**
 * Search for checklist pages. With Tavily, each result also carries the page's text (Tavily reads the page,
 * so sites that block our server still work). `domains` limits the search to those sites.
 */
export async function checklistSearch(query: string, profileId?: string, domains?: string[]): Promise<WebResult[]> {
  const t = await tavily(query, { images: false, max: 6, raw: true, domains }, profileId);
  if (t?.results.length) return t.results;
  const q = domains?.length ? `${query} ${domains.map((d) => `site:${d}`).join(" OR ")}` : query;
  return braveWeb(q, profileId).catch(() => [] as WebResult[]);
}

/** Pictures of a card. Tavily first; Brave's image search if Tavily finds none. */
export async function imageSearch(query: string, count = 8, profileId?: string): Promise<ImageCandidate[]> {
  const t = await tavily(query, { images: true, max: 5 }, profileId);
  if (t && t.images.length) return t.images.slice(0, count);
  return braveImages(query, count, profileId).catch(() => []);
}

export const searchConfigured = () => hasTavily() || hasBrave();

/** Can any search service still be used this month? */
export async function searchAllowed(): Promise<boolean> {
  if (hasTavily() && (await tavilyAllowed())) return true;
  if (hasBrave() && (await braveAllowed())) return true;
  return false;
}

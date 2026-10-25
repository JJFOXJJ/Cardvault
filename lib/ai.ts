// Card identification and pricing using Google Gemini (free tier) + Brave web search.
//
// Flow for a scan:
//   1. Gemini reads the photo(s) and identifies the card (no web access needed).
//   2. Brave web search finds pages about recent sales of that exact card.
//   3. Gemini reads those search snippets and estimates the value.

import { braveWeb, type WebResult } from "./images";

// Free-tier models to try in order. Each has its own free allowance, so if one is busy
// or has no quota for this key, the next one usually works.
const MODELS = [
  ...(process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : []),
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
].filter((m, i, a) => a.indexOf(m) === i);

// Remember which model last worked so later requests in the same instance start there.
let preferred = 0;

export type Range = { low: number; mid: number; high: number };

export type Identification = {
  identified: boolean;
  confidence: "high" | "medium" | "low";
  category: string;
  name: string;
  subject: string | null;
  year: string | null;
  manufacturer: string | null;
  set_name: string | null;
  card_number: string | null;
  variant: string | null;
  graded: string | null;
  value_usd: Range | null;
  value_notes: string;
  price_sources: { title: string; url: string }[];
  image_query: string;
  price_query: string;
  is_pokemon: boolean;
};

export type Valuation = Pick<Identification, "value_usd" | "value_notes" | "price_sources"> & { failed?: boolean };

const CATEGORIES = "Marvel, Basketball, The Simpsons, Pokémon, Other";

const IDENTIFY_PROMPT = `You are an expert trading card cataloguer. The collection mixes Marvel, basketball, The Simpsons and other cards, and may include Pokémon.

Identify the card in the photo(s). Read everything visible: player/character, card title, year, brand/manufacturer, set or series, card number (usually on the back), parallel/insert/refractor/holo, serial numbering (e.g. 23/99), autograph or memorabilia, and any grading slab label (company + grade).
Use your knowledge of card sets to fill in the set name and year when the design makes it clear. If unsure, give your best guess and set confidence to "low".

Reply with a JSON object with exactly these keys:
{
  "identified": boolean,
  "confidence": "high" | "medium" | "low",
  "category": one of ${CATEGORIES},
  "name": short display title, e.g. "Michael Jordan #57" or "Spider-Man #1",
  "subject": player or character name, or null,
  "year": string or null,
  "manufacturer": string or null (e.g. "Fleer", "SkyBox", "Panini", "Upper Deck"),
  "set_name": the set / collection, e.g. "1992 Marvel Masterpieces" or "2023-24 Panini Prizm", or null,
  "card_number": string or null,
  "variant": parallel / insert / holo / serial numbering, or null,
  "graded": e.g. "PSA 9", or null if raw,
  "image_query": a web image search query that would find a clean scan of the FRONT of this exact card,
  "price_query": a web search query to find recent SOLD prices for this exact card, e.g. "1986 Fleer Michael Jordan #57 sold price",
  "is_pokemon": boolean
}`;

const PRICE_PROMPT = `You are an expert trading card valuer for a collector in Australia.
Below are web search results about recent sales and listings of a specific card. Estimate the value of ONE copy in USD, for the stated grade, or raw near-mint if no grade is given.

Rules:
- Base the estimate on prices that appear in the search results. Sold prices are stronger evidence than asking prices; graded prices (PSA/BGS/CGC) are much higher than raw — don't mix them up.
- Convert AUD/EUR/GBP prices to USD roughly if needed.
- If the results don't show prices for this exact card, use your own knowledge of the card's market, lower the estimate's certainty, and say so in value_notes.
- Commons often sell for under $1. Don't inflate values.
- price_sources must be chosen ONLY from the URLs in the results (up to 4 most useful). Use [] if none were useful.

Reply with a JSON object:
{ "value_usd": { "low": number, "mid": number, "high": number } or null if you genuinely have no idea,
  "value_notes": one or two sentences on what the estimate is based on,
  "price_sources": [{ "title": string, "url": string }] }`;

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

async function gemini(parts: Part[], system: string, budgetMs = 50000): Promise<Record<string, unknown>> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set in Vercel");

  let lastError = "";
  const tried: string[] = [];
  const deadline = Date.now() + budgetMs;
  for (let n = 0; n < MODELS.length; n++) {
    const idx = (preferred + n) % MODELS.length;
    const model = MODELS[idx];

    for (let attempt = 0; attempt < 2; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining < 5000) {
        throw new Error(`Gemini is too slow right now — try again in a minute. (${lastError || "timed out"})`);
      }
      let res: Response;
      try {
        res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts }],
            generationConfig: { response_mime_type: "application/json", temperature: 0.2 },
          }),
          // One slow model shouldn't use up the whole budget.
          signal: AbortSignal.timeout(Math.min(35000, remaining)),
        });
      } catch (e) {
        // Timeout or network error: treat like "busy" and move on to the next model.
        lastError = `${model}: ${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error"}`;
        tried.push(`${model} (${e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error"})`);
        console.error("Gemini fetch failed", lastError, e);
        break;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let msg = body;
        try { msg = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? body; } catch { /* keep raw */ }
        lastError = `${model}: ${res.status} ${msg}`.slice(0, 400);
        tried.push(`${model} (${res.status === 503 ? "overloaded" : res.status === 429 ? "rate limit" : res.status === 404 ? "not available" : res.status})`);
        console.error("Gemini error", lastError);

        if (res.status === 400 || res.status === 401 || res.status === 403) {
          if (/api key/i.test(msg)) throw new Error("Gemini rejected the API key — check GEMINI_API_KEY in Vercel");
          if (/location|region|country/i.test(msg)) throw new Error(`Gemini isn't available for this account: ${msg}`);
        }
        // Quota/limit-0: no point retrying this model, move to the next one.
        if (res.status === 429 && /limit: ?0|quota/i.test(msg) && !/per ?minute/i.test(msg)) break;
        // Overloaded ("high demand"): don't wait around — go straight to the next model.
        if (res.status >= 500) break;
        // Per-minute rate limit: brief pause, one retry, then next model.
        if (res.status === 429) {
          if (attempt === 0) { await new Promise((r) => setTimeout(r, 2500)); continue; }
          break;
        }
        // 404 (model not offered to this key) or other: try the next model.
        break;
      }

      type GeminiResponse = { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
      const data = (await res.json()) as GeminiResponse;
      const text = data.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
      try {
        const raw = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
        const parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
        preferred = idx;
        return parsed;
      } catch {
        lastError = `${model}: response wasn't valid JSON`;
        if (attempt === 0) continue;
        break;
      }
    }
  }
  throw new Error(`Gemini's free models are all busy right now — try again in a few minutes. Tried: ${[...new Set(tried)].join(", ") || lastError}`);
}

function cleanValue(v: unknown): Range | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const low = Number(o.low), mid = Number(o.mid), high = Number(o.high);
  if (![low, mid, high].every((n) => isFinite(n) && n >= 0)) return null;
  return { low: Math.min(low, mid), mid, high: Math.max(high, mid) };
}

function cleanSources(v: unknown, allowed: WebResult[]): { title: string; url: string }[] {
  if (!Array.isArray(v)) return [];
  const urls = new Set(allowed.map((r) => r.url));
  return v
    .filter((s) => s && typeof s.url === "string" && urls.has(s.url))
    .slice(0, 4)
    .map((s) => ({ title: String(s.title || s.url), url: String(s.url) }));
}

/** Estimate value from Brave search results about the card. */
export async function priceCard(description: string, query?: string): Promise<Valuation> {
  const q = query || `${description.split("\n").slice(0, 6).map((l) => l.replace(/^[^:]+:\s*/, "")).join(" ")} sold price`;
  const results = await braveWeb(q).catch(() => [] as WebResult[]);

  const snippets = results.length
    ? results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}${r.age ? `\nDate: ${r.age}` : ""}\n${[r.description, ...(r.extra ?? [])].join(" … ")}`)
        .join("\n\n")
    : "(No web results available.)";

  let j: Record<string, unknown>;
  try {
    j = await gemini([{ text: `CARD\n${description}\n\nSEARCH RESULTS\n${snippets}` }], PRICE_PROMPT, 40000);
  } catch (e) {
    // Don't lose a good identification just because pricing timed out.
    return { failed: true, value_usd: null, value_notes: `Couldn't estimate a value this time (${e instanceof Error ? e.message : "error"}). Tap "Update value" later.`, price_sources: [] };
  }
  return {
    value_usd: cleanValue(j.value_usd),
    value_notes: typeof j.value_notes === "string" ? j.value_notes : "",
    price_sources: cleanSources(j.price_sources, results),
  };
}

export async function identifyCard(images: { mediaType: string; data: string }[], hint?: string): Promise<Identification> {
  const parts: Part[] = images.map((img) => ({ inline_data: { mime_type: img.mediaType, data: img.data } }));
  parts.push({
    text:
      (images.length > 1 ? "The first photo is the front of the card, the second is the back. " : "") +
      "Identify this trading card." +
      (hint?.trim() ? `\n\nThe owner adds this hint (trust it): ${hint.trim()}` : ""),
  });

  const j = await gemini(parts, IDENTIFY_PROMPT, 55000);
  const str = (k: string) => (typeof j[k] === "string" && (j[k] as string).trim() ? (j[k] as string).trim() : null);

  const card = {
    identified: Boolean(j.identified),
    confidence: (["high", "medium", "low"].includes(j.confidence as string) ? j.confidence : "low") as Identification["confidence"],
    category: str("category") ?? "Other",
    name: str("name") ?? "Unknown card",
    subject: str("subject"),
    year: str("year"),
    manufacturer: str("manufacturer"),
    set_name: str("set_name"),
    card_number: str("card_number"),
    variant: str("variant"),
    graded: str("graded"),
  };
  const fallbackQuery = [card.year, card.manufacturer, card.set_name, card.subject ?? card.name, card.card_number && `#${card.card_number}`, card.variant]
    .filter(Boolean).join(" ");

  const price_query = str("price_query") ?? `${fallbackQuery} sold price`;
  const valuation = await priceCard(describeCard(card), price_query);

  return {
    ...card,
    value_usd: valuation.value_usd,
    value_notes: valuation.value_notes,
    price_sources: valuation.price_sources,
    image_query: str("image_query") ?? `${fallbackQuery} card`,
    price_query,
    is_pokemon: Boolean(j.is_pokemon) || /pok[eé]mon/i.test(card.category),
  };
}

export function describeCard(c: {
  name?: string | null; subject?: string | null; year?: string | null; manufacturer?: string | null;
  set_name?: string | null; card_number?: string | null; variant?: string | null; graded?: string | null;
  condition?: string | null; category?: string | null;
}) {
  return [
    `Card: ${c.name}`,
    c.year && `Year: ${c.year}`,
    c.manufacturer && `Manufacturer: ${c.manufacturer}`,
    c.set_name && `Set: ${c.set_name}`,
    c.subject && `Player/character: ${c.subject}`,
    c.card_number && `Card number: ${c.card_number}`,
    c.variant && `Variant: ${c.variant}`,
    c.graded ? `Graded: ${c.graded}` : c.condition ? `Condition: ${c.condition}` : null,
    c.category && `Category: ${c.category}`,
  ].filter(Boolean).join("\n");
}

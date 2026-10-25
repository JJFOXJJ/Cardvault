// Helpers for keeping collection (set) names consistent.

const FILLER = new Set(["the", "set", "series", "cards", "card", "trading", "collection", "edition", "base", "and", "&"]);

/** Reduce a set name to comparable tokens: lowercase, no punctuation, no filler words. */
export function setTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/(\d{2,4})\s*[-–/]\s*(\d{2,4})/g, "$1-$2") // "1993 - 94" → "1993-94"
    .replace(/[^a-z0-9-]+/g, " ")
    .split(" ")
    .filter((t) => t && !FILLER.has(t));
}

const key = (name: string) => [...setTokens(name)].sort().join(" ");

const years = (name: string) => (name.match(/\b(19|20)\d{2}\b/g) ?? []).map((y) => y.slice(0, 4));

/**
 * Are two set names probably the same collection?
 * Same tokens in any order, or one's tokens are a subset of the other's (e.g. "Marvel Universe" vs
 * "1990 Impel Marvel Universe"), as long as any years mentioned don't conflict.
 */
export function sameCollection(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.trim().toLowerCase() === b.trim().toLowerCase()) return true;
  const ya = years(a), yb = years(b);
  if (ya.length && yb.length && !ya.some((y) => yb.includes(y))) return false;
  const ta = new Set(setTokens(a)), tb = new Set(setTokens(b));
  if (!ta.size || !tb.size) return false;
  if (key(a) === key(b)) return true;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const overlap = [...small].filter((t) => big.has(t)).length;
  // Subset match needs at least two meaningful words so "Marvel" alone doesn't swallow everything.
  return overlap === small.size && small.size >= 2;
}

/** If the AI's suggested set name matches one already in the vault, use the existing spelling. */
export function snapToExisting(suggested: string | null, existing: string[]): string | null {
  if (!suggested) return suggested;
  const exact = existing.find((e) => e.trim().toLowerCase() === suggested.trim().toLowerCase());
  if (exact) return exact;
  const same = existing.filter((e) => sameCollection(e, suggested));
  // Only snap when there's exactly one plausible match — otherwise leave it for the owner to decide.
  return same.length === 1 ? same[0] : suggested;
}

/** Groups of existing names that look like the same collection, for "merge?" suggestions. */
export function similarGroups(names: string[]): string[][] {
  const groups: string[][] = [];
  const used = new Set<string>();
  for (const a of names) {
    if (used.has(a)) continue;
    const g = [a, ...names.filter((b) => b !== a && !used.has(b) && sameCollection(a, b))];
    if (g.length > 1) {
      g.forEach((n) => used.add(n));
      groups.push(g);
    }
  }
  return groups;
}

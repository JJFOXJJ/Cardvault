import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { cardsOf, setsOf } from "@/lib/supabase";
import { findChecklist, matchCards } from "@/lib/checklist";
import { searchAllowed } from "@/lib/search";

export const maxDuration = 90;

const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/#\s*\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Preview every card in a collection before tracking it.
 * GET /api/sets/preview?name=X            → your cards, plus the checklist if it's free (library / Pokémon)
 * GET /api/sets/preview?name=X&search=1   → also searches the web for it (1 search), saved to the library
 * Nothing is tracked or changed in your vault.
 */
export async function GET(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const name = req.nextUrl.searchParams.get("name")?.trim();
  if (!name || name.length > 200) return jsonError("Missing set name");
  const search = req.nextUrl.searchParams.get("search") === "1";
  const force = search && req.nextUrl.searchParams.get("force") === "1"; // ignore the library's copy

  const esc = name.replace(/[%_]/g, "\\$&");
  const [{ data: mine }, { data: tracked }] = await Promise.all([
    cardsOf(me.id).select("id, name, subject, card_number, variant, image_url, photo_url, quantity, aud_mid").ilike("set_name", esc).neq("status", "pending"),
    setsOf(me.id).select("id, tracking, total").ilike("name", esc).maybeSingle(),
  ]);
  const cards = (mine ?? []).map((c) => ({ id: c.id, name: c.name, subject: c.subject, number: c.card_number, image: c.image_url ?? c.photo_url, qty: c.quantity ?? 1, value: c.aud_mid }));

  if (search && !(await searchAllowed())) return jsonError("This month's free searches are used up — the checklist can be loaded after the reset.", 429);
  let found;
  try {
    found = await findChecklist(me.id, name, { search, force });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Couldn't look up the checklist", 502);
  }

  const base = { name, cards, trackedId: tracked?.tracking && tracked.total ? tracked.id : null };
  if (!found) return NextResponse.json({ ...base, checklist: null, notFound: search });
  if (found.needsSearch) return NextResponse.json({ ...base, checklist: null, needsSearch: true });

  // Match your cards to the checklist by player (numbers from photos are often guesses).
  const list = found.list.map((e, i) => ({ ...e, id: String(i) }));
  const m = matchCards((mine ?? []).map((c) => ({ id: c.id, card_number: c.card_number, name: c.name, subject: c.subject, variant: c.variant })), list);
  const byEntry = new Map<string, (typeof cards)[number]>();
  for (const c of cards) { const hit = m.get(c.id); if (hit && !byEntry.has(hit.entry.id)) byEntry.set(hit.entry.id, c); }
  const entries = list.map((e) => {
    const c = byEntry.get(e.id);
    return { number: e.number, name: e.name, subset: e.subset, image: e.image_url ?? null, est: e.est_aud ?? null, card: c ? { id: c.id, image: c.image, qty: c.qty } : null };
  });
  const used = new Set([...m.keys()]);
  return NextResponse.json({
    ...base,
    checklist: { source: found.source, url: found.url || null, shared: !!found.shared, entries },
    unmatched: cards.filter((c) => !used.has(c.id)).length,
  });
}

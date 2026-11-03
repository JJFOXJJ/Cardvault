// Read-only sharing of a collection: by secret link, or with chosen profiles in the app.
// Everything here reads ANOTHER profile's data on purpose, so every entry point checks access first.

import { randomBytes } from "node:crypto";
import { db, cardsOf, setsOf, setCardsOf } from "./supabase";
import { allRows } from "./paging";
import { setKey } from "./shared";
import { stackKey } from "./stack";

// ---------------------------------------------------------------- access

export type Access = { ownerId: string; ownerName: string; showValues: boolean; via: "link" | "profile" | "self" };

export const newToken = () => randomBytes(24).toString("base64url"); // 32 characters, unguessable

/** Public link → whose collection, or null if the link is off / wrong. */
export async function accessByToken(token: string): Promise<Access | null> {
  if (!/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  const { data, error } = await db().from("share_links").select("profile_id, show_values").eq("token", token).maybeSingle();
  if (error || !data) return null;
  const { data: p } = await db().from("profiles").select("id, name").eq("id", data.profile_id).maybeSingle();
  return p ? { ownerId: p.id, ownerName: p.name, showValues: data.show_values, via: "link" } : null;
}

/** In the app: may `viewerId` see `ownerId`'s collection? (You can always preview your own.) */
export async function accessForViewer(viewerId: string, viewerName: string, ownerId: string): Promise<Access | null> {
  if (!/^[0-9a-f-]{36}$/i.test(ownerId)) return null;
  if (ownerId === viewerId) return { ownerId, ownerName: viewerName, showValues: true, via: "self" };
  const { data, error } = await db().from("profile_shares").select("show_values").eq("owner_id", ownerId).eq("viewer_id", viewerId).maybeSingle();
  if (error || !data) return null;
  const { data: p } = await db().from("profiles").select("id, name").eq("id", ownerId).maybeSingle();
  return p ? { ownerId, ownerName: p.name, showValues: data.show_values, via: "profile" } : null;
}

// ---------------------------------------------------------------- what a viewer sees

export type ViewCard = {
  id: string; name: string; set_name: string | null; card_number: string | null; category: string;
  year: string | null; manufacturer: string | null; image: string | null; qty: number; value: number | null;
};
export type ViewSet = { id: string; name: string; total: number; owned: number; value: number | null; missingValue: number | null };
export type WantCard = { set: string; number: string | null; name: string; est: number | null; key: string };
export type View = {
  owner: string; showValues: boolean;
  totals: { cards: number; value: number | null; collections: number };
  cards: ViewCard[];      // one tile per card (copies stacked)
  sets: ViewSet[];        // tracked sets with completion
  wishlist: WantCard[];   // missing cards from tracked sets
  spares: ViewCard[];     // cards they have 2+ of
};

const normNum = (n: string | null | undefined) => (n ?? "").toString().trim().toLowerCase().replace(/^#/, "").replace(/^0+(?=\d)/, "").replace(/\s+/g, "");
const normName = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/#\s*\S+/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/** "Same card" for trading: same set (any word order) and number, or name when unnumbered. Variants are ignored on purpose. */
export function tradeKey(set: string | null | undefined, number: string | null | undefined, name: string | null | undefined): string | null {
  const s = setKey(set);
  if (!s) return null;
  const n = normNum(number);
  return n ? `${s}|#${n}` : normName(name) ? `${s}|n:${normName(name)}` : null;
}

type Row = {
  id: string; name: string; subject: string | null; set_name: string | null; card_number: string | null; category: string; year: string | null;
  manufacturer: string | null; variant: string | null; graded: string | null; image_url: string | null; quantity: number | null; aud_mid: number | null;
  checklist_id: string | null; created_at: string;
};

/** Build the read-only view of one profile. Values are left out entirely when the owner hides them. */
export async function loadView(a: Access): Promise<View> {
  const { data: rows } = await allRows<Row>((from, to) => cardsOf(a.ownerId)
    .select("id, name, subject, set_name, card_number, category, year, manufacturer, variant, graded, image_url, quantity, aud_mid, checklist_id, created_at")
    .neq("status", "pending").order("created_at", { ascending: false }).order("id").range(from, to));
  const v = (n: number) => (a.showValues ? Math.round(n * 100) / 100 : null);

  // Stack copies of the same card into one tile.
  const stacks = new Map<string, Row[]>();
  for (const r of rows) { const k = stackKey(r) ?? `id:${r.id}`; stacks.set(k, [...(stacks.get(k) ?? []), r]); }
  const cards: ViewCard[] = [...stacks.values()].map((cs) => {
    const top = cs.find((c) => c.image_url) ?? cs[0];
    const qty = cs.reduce((n, c) => n + (c.quantity ?? 1), 0);
    return {
      id: top.id, name: top.name, set_name: top.set_name, card_number: top.card_number, category: top.category, year: top.year, manufacturer: top.manufacturer,
      image: top.image_url, qty, value: a.showValues ? top.aud_mid : null,
    };
  });

  // Tracked sets: completion and the missing cards (the wishlist).
  const { data: sets } = await setsOf(a.ownerId).select("id, name, total").eq("tracking", true).gt("total", 0);
  const ownedEntries = new Set(rows.map((r) => r.checklist_id).filter(Boolean) as string[]);
  // Also cards they own that aren't linked to the checklist (e.g. scanned later) — never "wanted".
  const ownedKeys = new Set(rows.map((r) => tradeKey(r.set_name, r.card_number, r.subject || r.name)).filter(Boolean) as string[]);
  const viewSets: ViewSet[] = [];
  const wishlist: WantCard[] = [];
  for (const s of sets ?? []) {
    const { data: entries } = await allRows<{ id: string; number: string | null; name: string; est_aud: number | null }>((from, to) =>
      setCardsOf(a.ownerId).select("id, number, name, est_aud, sort").eq("set_id", s.id).order("sort").range(from, to));
    let owned = 0, missingValue = 0;
    for (const e of entries) {
      const key = tradeKey(s.name, e.number, e.name);
      if (ownedEntries.has(e.id) || (key && ownedKeys.has(key))) { owned++; continue; }
      missingValue += Number(e.est_aud ?? 0);
      if (key) wishlist.push({ set: s.name, number: e.number, name: e.name, est: a.showValues && e.est_aud != null ? Number(e.est_aud) : null, key });
    }
    const value = rows.filter((r) => r.checklist_id && entries.some((e) => e.id === r.checklist_id)).reduce((n, r) => n + Number(r.aud_mid ?? 0) * (r.quantity ?? 1), 0);
    viewSets.push({ id: s.id, name: s.name, total: entries.length, owned, value: v(value), missingValue: v(missingValue) });
  }
  viewSets.sort((x, y) => y.owned / Math.max(1, y.total) - x.owned / Math.max(1, x.total));

  const totalValue = rows.reduce((n, r) => n + Number(r.aud_mid ?? 0) * (r.quantity ?? 1), 0);
  return {
    owner: a.ownerName,
    showValues: a.showValues,
    totals: { cards: rows.reduce((n, r) => n + (r.quantity ?? 1), 0), value: v(totalValue), collections: new Set(rows.map((r) => r.set_name?.trim().toLowerCase()).filter(Boolean)).size },
    cards,
    sets: viewSets,
    wishlist,
    spares: cards.filter((c) => c.qty > 1),
  };
}

// ---------------------------------------------------------------- trade matches

export type Match = { card: ViewCard; spare: number; key: string };

/** Their spares that are on `wants`, keeping one copy for them. */
function matchSpares(spares: ViewCard[], wants: WantCard[]): Match[] {
  const want = new Set(wants.map((w) => w.key));
  return spares
    .map((c) => ({ card: c, spare: c.qty - 1, key: tradeKey(c.set_name, c.card_number, c.name) ?? "" }))
    .filter((m) => m.key && want.has(m.key));
}

/** When I look at someone who shared with me: what each of us could give the other. */
export async function tradeMatches(me: { id: string; name: string }, them: View) {
  const mine = await loadView({ ownerId: me.id, ownerName: me.name, showValues: true, via: "self" });
  return {
    theyCanGive: matchSpares(them.spares, mine.wishlist), // their spares I'm missing
    iCanGive: matchSpares(mine.spares, them.wishlist),    // my spares they're missing
  };
}

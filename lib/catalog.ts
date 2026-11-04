// The approved set list ("catalog"): one standard name, details and checklist per set, maintained by admins.
// Admins never touch the cards themselves — only which set name they're filed under (when merging/renaming)
// and the checklist tracked sets use.

import { db } from "./supabase";
import { allRows } from "./paging";
import { setKey } from "./shared";
import { similarGroups } from "./collections";
import { buildChecklist, getSet, linkExistingCards, type ChecklistEntry } from "./checklist";

export type CatalogSet = {
  id: string; name: string; aliases: string[]; category: string | null; year: string | null; manufacturer: string | null;
  checklist: ChecklistEntry[]; checklist_source: string | null; checklist_url: string | null; checklist_updated_at: string | null;
};
const COLS = "id, name, aliases, category, year, manufacturer, checklist, checklist_source, checklist_url, checklist_updated_at";
const low = (s: string) => s.trim().toLowerCase();
const esc = (s: string) => s.replace(/[%_]/g, "\\$&");

export async function catalog(): Promise<{ sets: CatalogSet[]; available: boolean }> {
  const { data, error } = await db().from("catalog_sets").select(COLS).order("name");
  if (error) return { sets: [], available: false };
  return { sets: (data ?? []) as CatalogSet[], available: true };
}

/** Approved name for a set name: exact name or alias, or the same words in another order. null if not listed. */
export async function canonicalSetName(name: string | null | undefined, list?: CatalogSet[]): Promise<string | null> {
  if (!name?.trim()) return null;
  const sets = list ?? (await catalog()).sets;
  const n = low(name), k = setKey(name);
  return (sets.find((s) => low(s.name) === n || s.aliases.includes(n)) ?? sets.find((s) => setKey(s.name) === k || s.aliases.some((a) => setKey(a) === k)))?.name ?? null;
}

/** Approved names (for scans and dropdowns). */
export async function approvedNames(): Promise<string[]> {
  return (await catalog()).sets.map((s) => s.name);
}

/** The approved checklist for a set, if the admin has set one. */
export async function approvedChecklist(setName: string) {
  const { sets } = await catalog();
  const name = await canonicalSetName(setName, sets);
  const s = name ? sets.find((x) => x.name === name) : null;
  if (!s || s.checklist.length < 1) return null;
  return { list: s.checklist, url: s.checklist_url ?? "", source: "approved", shared: true, pricedAt: null };
}

// ---------------------------------------------------------------- overview for the admin page

export type InUse = { name: string; profiles: number; cards: number; tracked: number };
export type OverviewRow = InUse & {
  status: "approved" | "rename" | "pending";   // rename = matches an approved set under a different spelling
  approvedName: string | null;
  catalog: (Omit<CatalogSet, "checklist"> & { checklistCount: number }) | null;
};

export async function setOverview() {
  const { sets, available } = await catalog();
  const { data: cards } = await allRows<{ profile_id: string; set_name: string | null; quantity: number | null }>((f, t) =>
    db().from("cards").select("profile_id, set_name, quantity").not("set_name", "is", null).order("id").range(f, t));
  const { data: tracked } = await allRows<{ name: string }>((f, t) => db().from("sets").select("name").eq("tracking", true).order("id").range(f, t));
  const use = new Map<string, { name: string; profiles: Set<string>; cards: number }>();
  for (const c of cards) {
    const name = c.set_name!.trim();
    if (!name) continue;
    const u = use.get(name) ?? { name, profiles: new Set<string>(), cards: 0 };
    u.profiles.add(c.profile_id);
    u.cards += c.quantity ?? 1;
    use.set(name, u);
  }
  const trackedBy = new Map<string, number>();
  for (const t of tracked) trackedBy.set(low(t.name), (trackedBy.get(low(t.name)) ?? 0) + 1);

  const slim = (s: CatalogSet) => { const { checklist, ...rest } = s; return { ...rest, checklistCount: checklist.length }; };
  const rows: OverviewRow[] = [];
  for (const u of use.values()) {
    const approvedName = await canonicalSetName(u.name, sets);
    const cat = approvedName ? sets.find((s) => s.name === approvedName)! : null;
    rows.push({
      name: u.name, profiles: u.profiles.size, cards: u.cards, tracked: trackedBy.get(low(u.name)) ?? 0,
      status: approvedName === u.name ? "approved" : approvedName ? "rename" : "pending",
      approvedName, catalog: approvedName === u.name && cat ? slim(cat) : null,
    });
  }
  // Approved sets nobody has cards in yet.
  for (const s of sets) if (!use.has(s.name)) rows.push({ name: s.name, profiles: 0, cards: 0, tracked: trackedBy.get(low(s.name)) ?? 0, status: "approved", approvedName: s.name, catalog: slim(s) });
  rows.sort((a, b) => a.name.localeCompare(b.name));

  // Likely duplicates: pending names similar to each other or to an approved set.
  const pendingNames = rows.filter((r) => r.status !== "approved").map((r) => r.name);
  const groups = similarGroups([...rows.filter((r) => r.status === "approved").map((r) => r.name), ...pendingNames])
    .filter((g) => g.some((n) => pendingNames.includes(n)))
    .map((g) => {
      const approved = g.find((n) => rows.find((r) => r.name === n)?.status === "approved");
      const byCards = [...g].sort((a, b) => (rows.find((r) => r.name === b)?.cards ?? 0) - (rows.find((r) => r.name === a)?.cards ?? 0));
      return { names: g, suggested: approved ?? byCards[0] };
    });
  // Names that already match an approved set under another spelling.
  for (const r of rows.filter((x) => x.status === "rename")) if (!groups.some((g) => g.names.includes(r.name))) groups.push({ names: [r.approvedName!, r.name], suggested: r.approvedName! });
  return { available, rows, duplicates: groups };
}

// ---------------------------------------------------------------- changes

/** Move every profile's cards (and tracked set) from one set name to another. Only the collection name changes. */
async function moveEverywhere(from: string, to: string) {
  if (low(from) === low(to) && from === to) return { cards: 0, profiles: 0 };
  const { data: moved, error } = await db().from("cards").update({ set_name: to, updated_at: new Date().toISOString() }).eq("set_name", from).select("profile_id");
  if (error) throw new Error(error.message);
  const profiles = new Set((moved ?? []).map((m) => m.profile_id as string));

  // Tracked sets: rename, or fold into the profile's existing set of the target name.
  const { data: fromSets } = await db().from("sets").select("id, profile_id").ilike("name", esc(from));
  for (const s of fromSets ?? []) {
    profiles.add(s.profile_id);
    const { data: target } = await db().from("sets").select("id").eq("profile_id", s.profile_id).ilike("name", esc(to)).maybeSingle();
    if (target && target.id !== s.id) {
      const { data: entries } = await db().from("set_cards").select("id").eq("set_id", s.id);
      const ids = (entries ?? []).map((e) => e.id);
      for (let i = 0; i < ids.length; i += 300) await db().from("cards").update({ checklist_id: null }).in("checklist_id", ids.slice(i, i + 300)).eq("profile_id", s.profile_id);
      await db().from("sets").delete().eq("id", s.id).eq("profile_id", s.profile_id);
    } else {
      await db().from("sets").update({ name: to }).eq("id", s.id).eq("profile_id", s.profile_id);
    }
  }
  // Re-match moved cards to the target set's checklist, where tracked.
  for (const pid of profiles) {
    const { data: t } = await db().from("sets").select("id").eq("profile_id", pid).ilike("name", esc(to)).eq("tracking", true).maybeSingle();
    const set = t ? await getSet(pid, t.id) : null;
    if (set?.total) await linkExistingCards(pid, set);
  }
  return { cards: moved?.length ?? 0, profiles: profiles.size };
}

/** Add a set name to the approved list as it is. */
export async function approve(name: string, details: Partial<Pick<CatalogSet, "category" | "year" | "manufacturer">> = {}) {
  const n = name.trim();
  if (!n || n.length > 200) throw new Error("Give the set a name.");
  const existing = await canonicalSetName(n);
  if (existing && low(existing) === low(n)) return existing;
  const { error } = await db().from("catalog_sets").insert({ name: n, ...details });
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "That set is already on the list." : error.message);
  // Adopt a checklist already found for this set (shared library), so tracking it stays free.
  return n;
}

/** Merge several names into one approved set (created if needed). Everyone's cards move to the approved name. */
export async function merge(names: string[], target: string) {
  const to = target.trim();
  if (!to) throw new Error("Choose the approved name.");
  const { sets } = await catalog();
  let t = sets.find((s) => low(s.name) === low(to));
  if (!t) { await approve(to); t = (await catalog()).sets.find((s) => low(s.name) === low(to))!; }
  const aliases = new Set(t.aliases);
  let cards = 0; const profiles = new Set<string>();
  for (const from of names.map((x) => x.trim()).filter((x) => x && x !== t!.name)) {
    const r = await moveEverywhere(from, t.name);
    cards += r.cards;
    aliases.add(low(from));
    // A merged name that was itself approved: fold it in (keep its checklist if the target has none).
    const old = sets.find((s) => s.id !== t!.id && low(s.name) === low(from));
    if (old) {
      old.aliases.forEach((a) => aliases.add(a));
      if (!t.checklist.length && old.checklist.length) {
        await db().from("catalog_sets").update({ checklist: old.checklist, checklist_source: old.checklist_source, checklist_url: old.checklist_url, checklist_updated_at: old.checklist_updated_at }).eq("id", t.id);
      }
      await db().from("catalog_sets").delete().eq("id", old.id);
    }
    void profiles;
  }
  aliases.delete(low(t.name));
  await db().from("catalog_sets").update({ aliases: [...aliases], updated_at: new Date().toISOString() }).eq("id", t.id);
  return { name: t.name, cards };
}

/** Rename an approved set. Everyone's cards follow; the old name becomes an alias. */
export async function rename(id: string, newName: string) {
  const n = newName.trim();
  if (!n || n.length > 200) throw new Error("Give the set a name.");
  const { data: s } = await db().from("catalog_sets").select(COLS).eq("id", id).maybeSingle();
  if (!s) throw new Error("Set not found");
  if (s.name === n) return { name: n, cards: 0 };
  const clash = (await catalog()).sets.find((x) => x.id !== id && low(x.name) === low(n));
  if (clash) return merge([s.name], clash.name);
  const { error } = await db().from("catalog_sets").update({ name: n, aliases: [...new Set([...(s.aliases ?? []), low(s.name)])].filter((a) => a !== low(n)), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  const r = await moveEverywhere(s.name, n);
  return { name: n, cards: r.cards };
}

export async function updateDetails(id: string, d: Partial<Pick<CatalogSet, "category" | "year" | "manufacturer">>) {
  const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
  const { error } = await db().from("catalog_sets").update({ category: clean(d.category), year: clean(d.year), manufacturer: clean(d.manufacturer), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function unapprove(id: string) {
  const { error } = await db().from("catalog_sets").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function getCatalogSet(id: string): Promise<CatalogSet | null> {
  const { data } = await db().from("catalog_sets").select(COLS).eq("id", id).maybeSingle();
  return (data as CatalogSet) ?? null;
}

/**
 * Set the approved checklist, then update everyone tracking the set straight away
 * (their cards are re-matched by player; ticked cards stay ticked).
 */
export async function setChecklist(id: string, list: ChecklistEntry[], source: string, url: string | null) {
  if (list.length < 1) throw new Error("The checklist is empty.");
  const s = await getCatalogSet(id);
  if (!s) throw new Error("Set not found");
  const entries = list.map(({ number, name, subset }) => ({ number: number ?? null, name, subset: subset ?? null }));
  const { error } = await db().from("catalog_sets").update({ checklist: entries, checklist_source: source, checklist_url: url, checklist_updated_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);

  const names = [s.name, ...s.aliases];
  const { data: trackers } = await allRows<{ id: string; profile_id: string; name: string }>((f, t) => db().from("sets").select("id, profile_id, name").eq("tracking", true).order("id").range(f, t));
  let updated = 0;
  for (const t of trackers.filter((x) => names.some((n) => low(n) === low(x.name)))) {
    const set = await getSet(t.profile_id, t.id);
    if (!set) continue;
    await buildChecklist(t.profile_id, set, undefined, { preset: { list: entries, url: url ?? "", source: "approved", shared: true } });
    updated++;
  }
  return { cards: entries.length, profilesUpdated: updated };
}

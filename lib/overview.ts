import { db } from "./supabase";
import { allRows } from "./paging";
import { usageSummary, type UsageSummary } from "./usage";

export type ProfileStats = {
  id: string; name: string; is_admin: boolean;
  cards: number; value: number; waiting: number; collections: number; sets: number; addedWeek: number; searches: number;
};
export type Overview = {
  totals: Omit<ProfileStats, "id" | "name" | "is_admin"> & { profiles: number };
  profiles: ProfileStats[];
  usage: UsageSummary;
};

/** Admin-only totals. Numbers only — never another profile's cards. */
export async function adminOverview(): Promise<Overview> {
  const weekAgo = Date.now() - 7 * 86_400_000;
  const [{ data: profiles }, cards, sets, usage] = await Promise.all([
    db().from("profiles").select("id, name, is_admin").order("created_at"),
    allRows<{ profile_id: string; quantity: number | null; aud_mid: number | null; status: string; set_name: string | null; created_at: string }>(
      (from, to) => db().from("cards").select("profile_id, quantity, aud_mid, status, set_name, created_at").order("id").range(from, to)),
    allRows<{ profile_id: string; tracking: boolean }>((from, to) => db().from("sets").select("profile_id, tracking").order("id").range(from, to)),
    usageSummary(),
  ]);

  const searchesByName = new Map(usage.brave.byProfile.map((p) => [p.name, p.count]));
  const rows = new Map<string, ProfileStats & { names: Set<string> }>();
  for (const p of profiles ?? []) {
    rows.set(p.id, { id: p.id, name: p.name, is_admin: p.is_admin, cards: 0, value: 0, waiting: 0, collections: 0, sets: 0, addedWeek: 0,
      searches: searchesByName.get(p.name) ?? 0, names: new Set() });
  }
  for (const c of cards.data) {
    const r = rows.get(c.profile_id);
    if (!r) continue;
    const q = c.quantity ?? 1;
    if (c.status === "pending") { r.waiting += q; continue; }
    r.cards += q;
    r.value += Number(c.aud_mid ?? 0) * q;
    if (c.set_name?.trim()) r.names.add(c.set_name.trim().toLowerCase());
    if (Date.parse(c.created_at) >= weekAgo) r.addedWeek += q;
  }
  for (const s of sets.error ? [] : sets.data) {
    const r = rows.get(s.profile_id);
    if (r && s.tracking) r.sets++;
  }

  const list = [...rows.values()].map(({ names, ...r }) => ({ ...r, collections: names.size, value: Math.round(r.value * 100) / 100 }));
  const sum = (k: keyof Omit<ProfileStats, "id" | "name" | "is_admin">) => list.reduce((n, r) => n + r[k], 0);
  return {
    totals: { profiles: list.length, cards: sum("cards"), value: Math.round(sum("value") * 100) / 100, waiting: sum("waiting"),
      collections: sum("collections"), sets: sum("sets"), addedWeek: sum("addedWeek"), searches: usage.brave.used },
    profiles: list.sort((a, b) => b.value - a.value),
    usage,
  };
}

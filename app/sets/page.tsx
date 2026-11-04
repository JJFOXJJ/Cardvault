import { redirect } from "next/navigation";
import Header from "@/components/Header";
import ViewSwitch from "@/components/ViewSwitch";
import SetsList, { type SetSummary } from "@/components/SetsList";
import { currentProfile } from "@/lib/auth";
import { cardsOf, setCardsOf, setsOf } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SetsPage() {
  const me = await currentProfile();
  if (!me) redirect("/login");

  const [{ data: sets, error }, { data: cards }] = await Promise.all([
    setsOf(me.id).select("id, name, tracking, total, source").order("name"),
    cardsOf(me.id).select("set_name, checklist_id, quantity, aud_mid").neq("status", "pending"),
  ]);

  if (error) {
    return (
      <>
        <Header />
        <main className="wrap" style={{ maxWidth: 760 }}>
          <ViewSwitch active="sets" />
          <p className="error">
            Set tracking needs a quick database update. In Supabase, open SQL Editor and run the contents of{" "}
            <code>supabase/migrations/005_sets.sql</code> from your GitHub repo, then refresh.
          </p>
        </main>
      </>
    );
  }

  const tracked = (sets ?? []).filter((s) => s.tracking);
  const { data: entries } = tracked.length
    ? await setCardsOf(me.id).select("id, set_id").in("set_id", tracked.map((s) => s.id))
    : { data: [] as { id: string; set_id: string }[] };
  const setOfEntry = new Map((entries ?? []).map((e) => [e.id, e.set_id]));

  // Per set: distinct checklist entries owned + value of linked cards.
  const owned = new Map<string, Set<string>>(), value = new Map<string, number>();
  for (const c of cards ?? []) {
    const sid = c.checklist_id ? setOfEntry.get(c.checklist_id) : undefined;
    if (!sid) continue;
    if (!owned.has(sid)) owned.set(sid, new Set());
    owned.get(sid)!.add(c.checklist_id);
    value.set(sid, (value.get(sid) ?? 0) + Number(c.aud_mid ?? 0) * (c.quantity ?? 1));
  }

  const summaries: SetSummary[] = tracked.map((s) => ({ id: s.id, name: s.name, total: s.total, owned: owned.get(s.id)?.size ?? 0, value: value.get(s.id) ?? 0 }));

  // Collections in the vault that aren't tracked as sets yet.
  const known = new Set((sets ?? []).filter((s) => s.tracking).map((s) => s.name.toLowerCase()));
  const counts = new Map<string, number>();
  let unsorted = 0;
  for (const c of cards ?? []) {
    const n = c.set_name?.trim();
    if (!n) { unsorted += c.quantity ?? 1; continue; }
    if (!known.has(n.toLowerCase())) counts.set(n, (counts.get(n) ?? 0) + (c.quantity ?? 1));
  }
  const untracked = [...counts.entries()].map(([name, cards]) => ({ name, cards })).sort((a, b) => b.cards - a.cards);

  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 760 }}>
        <ViewSwitch active="sets" />
        <SetsList sets={summaries} untracked={untracked} unsorted={unsorted} />
        {me.is_admin && <p className="small" style={{ marginTop: 18 }}><a href="/admin/sets">Admin: manage the approved set list →</a></p>}
      </main>
    </>
  );
}

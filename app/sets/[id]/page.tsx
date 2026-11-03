import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import SetView, { type Entry } from "@/components/SetView";
import { currentProfile } from "@/lib/auth";
import { getSet } from "@/lib/checklist";
import { cardsOf, setCardsOf } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function SetPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await currentProfile();
  if (!me) redirect("/login");
  const set = await getSet(me.id, (await params).id);
  if (!set) notFound();

  const { data: rows } = await setCardsOf(me.id).select("id, number, name, subset, image_url, est_aud").eq("set_id", set.id).order("sort");
  const ids = (rows ?? []).map((r) => r.id);
  const { data: owned } = ids.length
    ? await cardsOf(me.id).select("id, checklist_id, image_url, photo_url, aud_mid, quantity").in("checklist_id", ids)
    : { data: [] as Record<string, never>[] };

  // One entry can have several cards (duplicates scanned separately): add them up.
  const byEntry = new Map<string, Entry["card"]>();
  for (const c of owned ?? []) {
    const prev = byEntry.get(c.checklist_id);
    byEntry.set(c.checklist_id, {
      id: prev?.id ?? c.id,
      image: prev?.image ?? c.image_url ?? c.photo_url ?? null,
      value: (prev?.value ?? 0) + Number(c.aud_mid ?? 0) * (c.quantity ?? 1),
      quantity: (prev?.quantity ?? 0) + (c.quantity ?? 1),
    });
  }

  // Cards filed in this collection that the checklist doesn't include — a sign the checklist is incomplete.
  const { data: unlinkedRows } = await cardsOf(me.id).select("id, name, card_number, year")
    .ilike("set_name", set.name.replace(/[%_]/g, "\\$&")).neq("status", "pending").is("checklist_id", null).limit(300);
  const unlinked = (unlinkedRows ?? []).map((c) => ({ id: c.id as string, name: c.name as string, number: c.card_number as string | null, year: c.year as string | null }));

  const entries: Entry[] = (rows ?? []).map((r) => ({
    id: r.id, number: r.number, name: r.name, subset: r.subset, image: r.image_url, est: r.est_aud == null ? null : Number(r.est_aud),
    card: byEntry.get(r.id) ?? null,
  }));

  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 900 }}>
        <SetView set={set} entries={entries} unlinked={unlinked} />
      </main>
    </>
  );
}

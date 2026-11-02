import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CardDetail from "@/components/CardDetail";
import { cardsOf, setCardsOf, setsOf, type Card } from "@/lib/supabase";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const me = await currentProfile();
  if (!me) redirect("/login");
  const mine = cardsOf(me.id);
  const { data } = await mine.select("*").eq("id", id).maybeSingle();
  if (!data) notFound();

  let inSet: { id: string; name: string; number: string | null } | null = null;
  if (data.checklist_id) {
    const { data: entry } = await setCardsOf(me.id).select("set_id, number").eq("id", data.checklist_id).maybeSingle();
    if (entry) {
      const { data: s } = await setsOf(me.id).select("id, name").eq("id", entry.set_id).maybeSingle();
      if (s) inSet = { id: s.id, name: s.name, number: entry.number };
    }
  }
  return (
    <>
      <Header />
      <main className="wrap">
        <CardDetail card={data as Card} inSet={inSet} />
      </main>
    </>
  );
}

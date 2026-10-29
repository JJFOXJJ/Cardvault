import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import CardDetail from "@/components/CardDetail";
import { cardsOf, type Card } from "@/lib/supabase";
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
  return (
    <>
      <Header />
      <main className="wrap">
        <CardDetail card={data as Card} />
      </main>
    </>
  );
}

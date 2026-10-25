import { notFound } from "next/navigation";
import Header from "@/components/Header";
import CardDetail from "@/components/CardDetail";
import { db, type Card } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data } = await db().from("cards").select("*").eq("id", id).maybeSingle();
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

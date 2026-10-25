import Header from "@/components/Header";
import Collection from "@/components/Collection";
import { db, type Card } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data, error } = await db().from("cards").select("*").order("created_at", { ascending: false });

  return (
    <>
      <Header />
      <main className="wrap">
        {error ? (
          <p className="error">Couldn&apos;t load your cards: {error.message}. Check the Supabase settings and that schema.sql has been run.</p>
        ) : (
          <Collection cards={(data ?? []) as Card[]} />
        )}
      </main>
      <footer className="credit wrap">
        Values are estimates from online sales, converted to AUD. Search by{" "}
        <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer">Brave Search</a>.
      </footer>
    </>
  );
}

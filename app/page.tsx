import Link from "next/link";
import Header from "@/components/Header";
import Collection from "@/components/Collection";
import { db, type Card } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ data, error }, { count: waiting }] = await Promise.all([
    db().from("cards").select("*").neq("status", "pending").order("created_at", { ascending: false }),
    db().from("cards").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const needsMigration = error && /status/i.test(error.message);

  return (
    <>
      <Header />
      <main className="wrap">
        {!!waiting && (
          <Link href="/pending" className="waiting-banner">
            <span>📥</span>
            <span><b>{waiting} card{waiting === 1 ? "" : "s"}</b> waiting to be identified</span>
            <span className="spacer" />
            <span className="go">Review →</span>
          </Link>
        )}
        {needsMigration ? (
          <p className="error">
            The database needs a quick update for the new &ldquo;save for later&rdquo; feature. In Supabase, open SQL Editor and run the
            contents of <code>supabase/migrations/002_waiting_list.sql</code> from your GitHub repo, then refresh.
          </p>
        ) : error ? (
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

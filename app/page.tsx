import Link from "next/link";
import Header from "@/components/Header";
import Collection from "@/components/Collection";
import ClearJustAdded from "@/components/ClearJustAdded";
import { cardsOf, type Card } from "@/lib/supabase";
import { currentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  const mine = cardsOf(me.id);
  const [{ data, error }, { count: waiting }] = await Promise.all([
    mine.select("*").neq("status", "pending").order("created_at", { ascending: false }),
    mine.select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);

  const needsMigration = error && /status/i.test(error.message);

  return (
    <>
      <Header />
      <ClearJustAdded />
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

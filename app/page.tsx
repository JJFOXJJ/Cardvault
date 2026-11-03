import Link from "next/link";
import Header from "@/components/Header";
import Collection from "@/components/Collection";
import ClearJustAdded from "@/components/ClearJustAdded";
import { UsageMeter } from "@/components/Usage";
import ViewSwitch from "@/components/ViewSwitch";
import { cardsOf, db, type Card } from "@/lib/supabase";
import { allRows } from "@/lib/paging";
import { currentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function Home() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  const mine = cardsOf(me.id);
  const [{ data, error }, { count: waiting }, shares] = await Promise.all([
    // Every card, not just the first 1,000.
    allRows<Card>((from, to) => cardsOf(me.id).select("*").neq("status", "pending").order("created_at", { ascending: false }).order("id").range(from, to)),
    mine.select("id", { count: "exact", head: true }).eq("status", "pending"),
    // Collections other people shared with me (empty until migration 007 is run).
    db().from("profile_shares").select("owner_id").eq("viewer_id", me.id).then(async ({ data: rows, error: e }) => {
      if (e || !rows?.length) return [] as { id: string; name: string }[];
      const { data: ps } = await db().from("profiles").select("id, name").in("id", rows.map((r) => r.owner_id));
      return (ps ?? []) as { id: string; name: string }[];
    }),
  ]);

  const needsMigration = error && /status/i.test(error.message);

  return (
    <>
      <Header />
      <ClearJustAdded />
      <main className="wrap">
        <ViewSwitch active="cards" />
        {!!waiting && (
          <Link href="/pending" className="waiting-banner">
            <span>📥</span>
            <span><b>{waiting} card{waiting === 1 ? "" : "s"}</b> waiting to be identified</span>
            <span className="spacer" />
            <span className="go">Review →</span>
          </Link>
        )}
        {shares.length > 0 && (
          <div className="shared-banner">
            <span className="small muted">Shared with you:</span>
            {shares.map((p) => <Link key={p.id} href={`/shared/${p.id}`} className="chip">{p.name}&apos;s cards →</Link>)}
          </div>
        )}
        <UsageMeter />
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
        <a href="https://tavily.com" target="_blank" rel="noreferrer">Tavily</a> and{" "}
        <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer">Brave Search</a>.
      </footer>
    </>
  );
}

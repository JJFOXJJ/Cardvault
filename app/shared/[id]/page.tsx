import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import Header from "@/components/Header";
import SharedView, { TABS, type Tab } from "@/components/SharedView";
import { currentProfile } from "@/lib/auth";
import { accessForViewer, loadView, tradeMatches } from "@/lib/sharing";

export const dynamic = "force-dynamic";

/** Someone's collection, shared with me inside the app (or a preview of my own). */
export default async function SharedWithMe({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const me = await currentProfile();
  if (!me) redirect("/login");
  const { id } = await params;
  const access = await accessForViewer(me.id, me.name, id).catch(() => null);
  if (!access) notFound();

  const view = await loadView(access);
  const self = access.via === "self";
  const trade = self ? null : { ...(await tradeMatches(me, view)), me: me.name };
  const { tab } = await searchParams;
  const t = (TABS.includes(tab as Tab) ? tab : trade && (trade.theyCanGive.length || trade.iCanGive.length) ? "trade" : "cards") as Tab;

  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 900 }}>
        <SharedView view={view} tab={t} base={`/shared/${id}`} trade={trade}
          intro={self ? (
            <p className="small muted" style={{ margin: "4px 0 0" }}>This is what people you share with see (values show only if you allow them). <Link href="/sharing">Sharing settings →</Link></p>
          ) : (
            <p className="small muted" style={{ margin: "4px 0 0" }}>Shared with you by {view.owner}.{view.showValues ? "" : " Values are hidden."}</p>
          )} />
      </main>
    </>
  );
}

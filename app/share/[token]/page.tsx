import type { Metadata } from "next";
import Link from "next/link";
import SharedView, { TABS, type Tab } from "@/components/SharedView";
import { accessByToken, loadView } from "@/lib/sharing";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared collection · Card Vault", robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Public, read-only collection behind a secret link. No PIN; nothing can be changed. */
export default async function PublicShare({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { token } = await params;
  const { tab } = await searchParams;
  const access = await accessByToken(token).catch(() => null);

  return (
    <>
      <header className="public-top">
        <div className="wrap">
          <span className="brand"><span className="brand-mark" aria-hidden /> Card Vault</span>
        </div>
      </header>
      <main className="wrap" style={{ maxWidth: 900 }}>
        {access ? (
          <SharedView view={await loadView(access)} tab={(TABS.includes(tab as Tab) ? tab : "cards") as Tab} base={`/share/${token}`} />
        ) : (
          <div className="empty">
            <div className="brand-mark" />
            <h1>This link isn&apos;t active</h1>
            <p className="muted">The owner may have turned sharing off or made a new link. Ask them for the latest one.</p>
            <Link href="/login" className="btn small" style={{ marginTop: 10 }}>Sign in to Card Vault</Link>
          </div>
        )}
      </main>
    </>
  );
}

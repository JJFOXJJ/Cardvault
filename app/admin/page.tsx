import Link from "next/link";
import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Backups from "@/components/Backups";
import Library from "@/components/Library";
import { UsageMeter } from "@/components/Usage";
import { currentProfile } from "@/lib/auth";
import { adminOverview } from "@/lib/overview";

export const dynamic = "force-dynamic";

const aud = (n: number) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`;

export default async function AdminPage() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  if (!me.is_admin) redirect("/profiles");
  const o = await adminOverview();
  const t = o.totals;

  return (
    <>
      <Header />
      <main className="wrap stack" style={{ maxWidth: 820 }}>
        <div>
          <h1>Admin overview</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>Totals for everyone. You see numbers only — never anyone else&apos;s cards.</p>
          <Link href="/admin/sets" className="btn small" style={{ marginTop: 10 }}>Set list — approve &amp; tidy sets →</Link>
        </div>

        <section className="worth" style={{ margin: "4px 0 0" }} aria-label="Total value">
          <div className="v">{aud(t.value)}</div>
          <p>Estimated value of <b>{plural(t.cards, "card")}</b> across <b>{plural(t.profiles, "profile")}</b>.</p>
        </section>

        <div className="admin-stats">
          <div className="stat"><b>{t.profiles}</b><span>Profiles</span></div>
          <div className="stat"><b>{t.cards.toLocaleString("en-AU")}</b><span>Cards</span></div>
          <div className="stat"><b>{t.collections}</b><span>Collections</span></div>
          <div className="stat"><b>{t.sets}</b><span>Sets tracked</span></div>
          <div className="stat"><b>{t.addedWeek}</b><span>Added this week</span></div>
          <div className="stat"><b>{t.waiting}</b><span>Waiting to identify</span></div>
        </div>

        <UsageMeter />

        <section className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="admin-table">
            <thead>
              <tr><th>Profile</th><th>Cards</th><th>Value</th><th>Collections</th><th>Sets</th><th>This week</th><th>Searches</th></tr>
            </thead>
            <tbody>
              {o.profiles.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="who">
                      <span className="avatar small">{p.name.slice(0, 1).toUpperCase()}</span>
                      <div>
                        {p.name}{p.id === me.id ? " (you)" : ""}
                        {(p.is_admin || p.waiting > 0) && <div className="small muted">{[p.is_admin && "admin", p.waiting > 0 && `${p.waiting} waiting`].filter(Boolean).join(" · ")}</div>}
                      </div>
                    </div>
                  </td>
                  <td>{p.cards.toLocaleString("en-AU")}</td>
                  <td className="val">{aud(p.value)}</td>
                  <td>{p.collections}</td>
                  <td>{p.sets}</td>
                  <td>{p.addedWeek ? `+${p.addedWeek}` : "—"}</td>
                  <td>{p.searches}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <p className="small muted" style={{ marginTop: -6 }}>
          Searches are this month&apos;s Tavily + Brave searches ({o.usage.searches.used}/{o.usage.searches.limit} shared). <Link href="/usage">Usage details →</Link> · <Link href="/profiles">Manage profiles →</Link>
        </p>

        <Library saved={o.usage.saved.count} />

        <Backups />
      </main>
    </>
  );
}

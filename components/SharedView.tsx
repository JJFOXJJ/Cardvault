import Link from "next/link";
import type { Match, View, ViewCard, WantCard } from "@/lib/sharing";
import { audS } from "@/lib/format";
import { Ring } from "./SetsList";

export type Tab = "cards" | "sets" | "wishlist" | "spares" | "trade";
export const TABS: Tab[] = ["cards", "sets", "wishlist", "spares", "trade"];

function Tile({ c, showValues, badge }: { c: ViewCard; showValues: boolean; badge?: string }) {
  return (
    <div className="tile">
      <div className="art">
        {c.image ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={c.image} alt={c.name} loading="lazy" />
        ) : (
          <span className="ck-plain">{c.card_number ? c.name.replace(new RegExp(`\\s*#\\s*${c.card_number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), "") : c.name}{c.card_number ? <small>#{c.card_number}</small> : null}</span>
        )}
        {(badge || c.qty > 1) && <span className="qty">{badge ?? `×${c.qty}`}</span>}
      </div>
      <div>
        <div className="t">{c.name}</div>
        <div className="s">{c.set_name || [c.year, c.manufacturer].filter(Boolean).join(" · ") || c.category}</div>
        {showValues && <div className="v">{audS(c.value)}</div>}
      </div>
    </div>
  );
}

function bySet<T>(items: T[], name: (t: T) => string | null) {
  const m = new Map<string, T[]>();
  for (const i of items) { const k = name(i)?.trim() || "Unsorted"; m.set(k, [...(m.get(k) ?? []), i]); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function Wishlist({ list, showValues }: { list: WantCard[]; showValues: boolean }) {
  if (!list.length) return <p className="muted">No missing cards — either every tracked set is complete, or no sets are tracked yet.</p>;
  return (
    <>
      {bySet(list, (w) => w.set).map(([set, ws]) => (
        <section key={set} className="panel" style={{ marginBottom: 12 }}>
          <div className="row"><b>{set}</b><span className="spacer" /><span className="small muted">{ws.length} missing</span></div>
          <ul className="want-list">
            {ws.map((w) => (
              <li key={w.key}><span className="num">{w.number ? `#${w.number}` : "—"}</span><span className="nm">{w.name}</span>{showValues && w.est != null && <span className="muted small">~{audS(w.est)}</span>}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function Matches({ title, empty, list, showValues }: { title: string; empty: string; list: Match[]; showValues: boolean }) {
  return (
    <section className="stack" style={{ gap: 10 }}>
      <h2 style={{ fontSize: 17 }}>{title} <span className="muted small">· {list.length}</span></h2>
      {list.length ? (
        <div className="cards size-s">{list.map((m) => <Tile key={m.card.id} c={m.card} showValues={showValues} badge={`${m.spare} spare`} />)}</div>
      ) : <p className="small muted" style={{ margin: 0 }}>{empty}</p>}
    </section>
  );
}

/** Read-only view of a collection, used by the public link and in-app sharing. */
export default function SharedView({ view, tab, base, trade, intro }: {
  view: View; tab: Tab; base: string; intro?: React.ReactNode;
  trade?: { theyCanGive: Match[]; iCanGive: Match[]; me: string } | null;
}) {
  const t = trade ? tab : tab === "trade" ? "cards" : tab;
  const counts: Record<Tab, number | null> = {
    cards: view.totals.cards, sets: view.sets.length, wishlist: view.wishlist.length, spares: view.spares.reduce((n, c) => n + c.qty - 1, 0),
    trade: trade ? trade.theyCanGive.length + trade.iCanGive.length : null,
  };
  const label: Record<Tab, string> = { cards: "Cards", sets: "Sets", wishlist: "Wishlist", spares: "Spares", trade: "Trade matches" };

  return (
    <div className="stack">
      <div>
        <p className="small muted" style={{ margin: 0 }}>Read-only</p>
        <h1>{view.owner}&apos;s collection</h1>
        {intro}
      </div>
      <section className="worth" style={{ margin: 0 }}>
        {view.showValues && <div className="v">{audS(view.totals.value, false)}</div>}
        <p><b>{view.totals.cards} card{view.totals.cards === 1 ? "" : "s"}</b> across <b>{view.totals.collections} collection{view.totals.collections === 1 ? "" : "s"}</b>
          {view.sets.length ? <> · <b>{view.sets.length}</b> set{view.sets.length === 1 ? "" : "s"} tracked</> : null}.</p>
      </section>

      <nav className="seg share-tabs" aria-label="Sections">
        {TABS.filter((x) => x !== "trade" || trade).map((x) => (
          <Link key={x} href={`${base}?tab=${x}`} className={t === x ? "on" : ""} scroll={false}>
            {label[x]}{counts[x] ? <span className="n">{counts[x]}</span> : null}
          </Link>
        ))}
      </nav>

      {t === "cards" && (view.cards.length ? bySet(view.cards, (c) => c.set_name).map(([set, cs]) => (
        <section key={set}>
          <div className="set-head"><h2>{set}</h2><span className="muted small set-count">{cs.reduce((n, c) => n + c.qty, 0)} cards</span></div>
          <div className="cards">{cs.map((c) => <Tile key={c.id} c={c} showValues={view.showValues} />)}</div>
        </section>
      )) : <p className="muted">No cards yet.</p>)}

      {t === "sets" && (view.sets.length ? (
        <section className="panel coll-list" style={{ padding: 0 }}>
          {view.sets.map((s) => (
            <div key={s.id} className="coll-row" style={{ cursor: "default" }}>
              <Ring owned={s.owned} total={s.total} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{s.name}</div>
                <div className="small muted">{s.owned} of {s.total}{view.showValues && s.missingValue ? ` · ~${audS(s.missingValue, false)} to complete` : ""}</div>
              </div>
              {view.showValues && <b style={{ color: "var(--lemon)" }}>{audS(s.value, false)}</b>}
            </div>
          ))}
        </section>
      ) : <p className="muted">No sets tracked yet.</p>)}

      {t === "wishlist" && <Wishlist list={view.wishlist} showValues={view.showValues} />}

      {t === "spares" && (view.spares.length ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>Cards {view.owner} has more than one of — the badge shows how many spares (keeping one).</p>
          <div className="cards">{view.spares.map((c) => <Tile key={c.id} c={c} showValues={view.showValues} badge={`${c.qty - 1} spare`} />)}</div>
        </>
      ) : <p className="muted">No spares — every card is a single copy.</p>)}

      {t === "trade" && trade && (
        <>
          <Matches title={`${view.owner}'s spares you're missing`} list={trade.theyCanGive} showValues={view.showValues}
            empty={`None yet. This uses the sets you track — ${view.owner}'s spares are matched against the missing cards in your sets.`} />
          <Matches title={`Your spares ${view.owner} is missing`} list={trade.iCanGive} showValues
            empty={`None yet. Your spares are matched against the missing cards in ${view.owner}'s tracked sets.`} />
        </>
      )}
    </div>
  );
}

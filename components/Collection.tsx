"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Card } from "@/lib/supabase";
import { aud } from "@/lib/client";

type Sort = "set" | "value" | "recent" | "name";

export default function Collection({ cards }: { cards: Card[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [sort, setSort] = useState<Sort>("set");

  const categories = useMemo(() => ["All", ...Array.from(new Set(cards.map((c) => c.category))).sort()], [cards]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (cat !== "All" && c.category !== cat) return false;
      if (!needle) return true;
      return [c.name, c.subject, c.set_name, c.manufacturer, c.year, c.card_number, c.variant, c.notes]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [cards, q, cat]);

  const totals = useMemo(() => {
    const count = filtered.reduce((n, c) => n + c.quantity, 0);
    const value = filtered.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0);
    const sets = new Set(filtered.map((c) => c.set_name || "Unsorted")).size;
    return { count, value, sets };
  }, [filtered]);

  const groups = useMemo(() => {
    const list = [...filtered];
    if (sort === "value") list.sort((a, b) => (b.aud_mid ?? 0) - (a.aud_mid ?? 0));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "recent") list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else list.sort((a, b) => (a.card_number ?? "").localeCompare(b.card_number ?? "", undefined, { numeric: true }));

    if (sort !== "set") return [{ name: "", cards: list, value: 0 }];
    const map = new Map<string, Card[]>();
    for (const c of list) {
      const key = c.set_name || "Unsorted";
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()]
      .map(([name, cs]) => ({ name, cards: cs, value: cs.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0) }))
      .sort((a, b) => b.value - a.value);
  }, [filtered, sort]);

  if (!cards.length) {
    return (
      <div className="empty">
        <div className="brand-mark" />
        <h1>Your vault is empty</h1>
        <p className="muted">Photograph a card and it&apos;ll be identified, valued and filed into its set.</p>
        <Link href="/add" className="btn primary" style={{ marginTop: 10 }}>Scan your first card</Link>
      </div>
    );
  }

  return (
    <>
      <section className="hero">
        <div className="stat gold"><b>{aud(totals.value, false)}</b><span>Estimated value</span></div>
        <div className="stat"><b>{totals.count}</b><span>Cards</span></div>
        <div className="stat"><b>{totals.sets}</b><span>Collections</span></div>
      </section>

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, player, set, number…" type="search" />
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="set">Group by collection</option>
          <option value="value">Highest value</option>
          <option value="recent">Recently added</option>
          <option value="name">A–Z</option>
        </select>
        <a href="/api/export" className="btn small">Export CSV</a>
      </div>

      <div className="chips">
        {categories.map((c) => (
          <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      {!filtered.length && <p className="muted">No cards match.</p>}

      {groups.map((g) => (
        <section key={g.name || "all"}>
          {g.name && (
            <div className="set-head">
              <h2>{g.name}</h2>
              <span className="muted small">{g.cards.reduce((n, c) => n + c.quantity, 0)} cards</span>
              <span className="spacer" />
              <span>{aud(g.value, false)}</span>
            </div>
          )}
          <div className="cards">
            {g.cards.map((c) => (
              <Link key={c.id} href={`/card/${c.id}`} className="tile">
                <div className="art">
                  {c.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.image_url} alt={c.name} loading="lazy" />
                  ) : null}
                  {c.quantity > 1 && <span className="qty">×{c.quantity}</span>}
                  {c.image_url && c.image_url === c.photo_url && <span className="own">your photo</span>}
                </div>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="s">{[c.year, c.manufacturer].filter(Boolean).join(" · ") || c.category}</div>
                  <div className="v">{aud(c.aud_mid)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

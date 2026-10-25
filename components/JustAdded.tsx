"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { aud } from "@/lib/client";
import { clearAdded, getAdded, onAddedChange, setAdded } from "@/lib/session-added";

type Mini = {
  id: string;
  name: string;
  set_name: string | null;
  image_url: string | null;
  photo_url: string | null;
  aud_mid: number | null;
  quantity: number;
  confidence: string | null;
  status: string;
};

/** Cards added in this session, with live values. Tap one to open it. */
export default function JustAdded({ title = "Just added", lockLinks = false }: { title?: string; lockLinks?: boolean }) {
  const [cards, setCards] = useState<Mini[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let live = true;
    async function load() {
      const ids = getAdded();
      if (!ids.length) { setCards([]); return; }
      setLoading(true);
      try {
        const res = await fetch(`/api/cards?ids=${ids.join(",")}`);
        if (!res.ok) return;
        const d = (await res.json()) as { cards: Mini[] };
        if (!live) return;
        setCards(d.cards);
        // Forget cards that were deleted in the meantime.
        if (d.cards.length !== ids.length) setAdded(d.cards.map((c) => c.id));
      } finally {
        if (live) setLoading(false);
      }
    }
    load();
    const off = onAddedChange(load);
    // Refresh values when coming back to this page (e.g. after editing a card).
    const onShow = () => document.visibilityState === "visible" && load();
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onShow);
    return () => { live = false; off(); window.removeEventListener("pageshow", onShow); document.removeEventListener("visibilitychange", onShow); };
  }, []);

  if (!cards.length) return loading ? null : null;

  const total = cards.reduce((n, c) => n + (c.aud_mid ?? 0) * (c.quantity ?? 1), 0);
  const count = cards.reduce((n, c) => n + (c.quantity ?? 1), 0);

  return (
    <section className="panel stack just-added">
      <div className="row">
        <h2 style={{ fontSize: 18 }}>{title}</h2>
        <span className="muted small">{count} card{count === 1 ? "" : "s"}</span>
        <span className="spacer" />
        <b style={{ color: "var(--accent)" }}>{aud(total, false)}</b>
      </div>
      <div className="cards">
        {cards.map((c) => {
          const tile = (
            <>
              <div className="art">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {(c.image_url || c.photo_url) && <img src={(c.image_url || c.photo_url)!} alt={c.name} loading="lazy" />}
                {c.quantity > 1 && <span className="qty">×{c.quantity}</span>}
                {c.confidence === "low" && <span className="own" style={{ color: "var(--bad)" }}>check this</span>}
              </div>
              <div>
                <div className="t">{c.name}</div>
                <div className="s">{c.set_name || "Unsorted"}</div>
                <div className="v">{aud(c.aud_mid)}</div>
              </div>
            </>
          );
          return lockLinks ? (
            <div key={c.id} className="tile" title="Available when the run finishes">{tile}</div>
          ) : (
            <Link key={c.id} href={`/card/${c.id}`} className="tile">{tile}</Link>
          );
        })}
      </div>
      <button className="btn ghost small" style={{ justifySelf: "start" }} onClick={clearAdded}>Clear this list</button>
    </section>
  );
}

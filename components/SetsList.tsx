"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { aud } from "@/lib/client";
import { useTrackSet } from "@/lib/track";

export type SetSummary = { id: string; name: string; total: number; owned: number; value: number };

export function Ring({ owned, total, size = 52 }: { owned: number; total: number; size?: number }) {
  const pct = total ? Math.round((owned / total) * 100) : 0;
  const done = total > 0 && owned >= total;
  return (
    <div className="ring" style={{ ["--p" as string]: pct, width: size, height: size }} role="img" aria-label={`${owned} of ${total} cards`}>
      <div><span>{total ? (done ? "✓" : `${pct}%`) : "?"}</span></div>
    </div>
  );
}

export default function SetsList({ sets, untracked, unsorted }: { sets: SetSummary[]; untracked: { name: string; cards: number }[]; unsorted: number }) {
  const router = useRouter();
  const { track, stage, busy } = useTrackSet();
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  const totalOwned = sets.reduce((n, s) => n + s.owned, 0);
  const totalCards = sets.reduce((n, s) => n + s.total, 0);
  const totalValue = sets.reduce((n, s) => n + s.value, 0);

  async function start(name: string) {
    setWorking(name);
    setError("");
    const r = await track(name);
    setWorking("");
    if (r?.id) router.push(`/sets/${r.id}`);
    else setError(r?.error ?? "Couldn't start tracking that set");
  }

  return (
    <div className="stack">
      <div>
        <h1>Your sets</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          {sets.length
            ? `${sets.length} set${sets.length === 1 ? "" : "s"} · ${totalOwned} of ${totalCards} cards · ${aud(totalValue, false)}`
            : "Track a set to see every card in it and tick off the ones you have."}
        </p>
      </div>
      {error && <p className="error">{error}</p>}

      {sets.map((s) => (
        <Link key={s.id} href={`/sets/${s.id}`} className="set-row">
          <Ring owned={s.owned} total={s.total} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{s.name}</h2>
            <div className="small muted">
              {s.total ? `${s.owned} of ${s.total}` : "No checklist yet"} · {aud(s.value, false)}
              {s.total > 0 && s.owned >= s.total && <span className="badge high" style={{ marginLeft: 8 }}>Complete</span>}
            </div>
            <div className="progress" style={{ marginTop: 7 }}><i style={{ width: `${s.total ? Math.min(100, (s.owned / s.total) * 100) : 0}%` }} /></div>
          </div>
        </Link>
      ))}

      {untracked.length > 0 && (
        <section className="stack" style={{ gap: 8, marginTop: 10 }}>
          <h2 style={{ fontSize: 15 }}>Collections you could track</h2>
          <p className="small muted" style={{ margin: 0 }}>Tap one to see every card in the set before tracking it. Tracking finds the full checklist so you can see what&apos;s missing — up to 2 searches, or none if it&apos;s already in the shared library.</p>
          {untracked.map((u) => (
            <div key={u.name} className="set-row quiet">
              <Link href={`/sets/preview?name=${encodeURIComponent(u.name)}`} style={{ flex: 1, minWidth: 0 }} className="preview-link">
                <b>{u.name}</b>
                <div className="small muted">{u.cards} card{u.cards === 1 ? "" : "s"} in your vault · <span style={{ color: "var(--cyan)" }}>See all cards →</span></div>
                {working === u.name && <div className="small" style={{ color: "var(--cyan)", marginTop: 4 }}>{stage}</div>}
              </Link>
              <button className="btn small" onClick={() => start(u.name)} disabled={busy}>
                {working === u.name ? <span className="spinner" /> : "Track set"}
              </button>
            </div>
          ))}
        </section>
      )}

      {unsorted > 0 && (
        <Link href="/" className="set-row quiet">
          <Ring owned={0} total={0} />
          <div><b>Unsorted cards</b><div className="small muted">{unsorted} card{unsorted === 1 ? "" : "s"} without a collection</div></div>
        </Link>
      )}
    </div>
  );
}

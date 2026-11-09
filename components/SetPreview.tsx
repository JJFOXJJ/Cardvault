"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api, aud } from "@/lib/client";
import { useTrackSet } from "@/lib/track";
import { Ring } from "./SetsList";

type Entry = { number: string | null; name: string; subset: string | null; image: string | null; est: number | null; card: { id: string; image: string | null; qty: number } | null };
type Mine = { id: string; name: string; number: string | null; image: string | null; qty: number; value: number | null };
type Data = {
  name: string; cards: Mine[]; trackedId: string | null;
  checklist: { source: string; url: string | null; shared: boolean; entries: Entry[] } | null;
  needsSearch?: boolean; notFound?: boolean; unmatched?: number;
};

const SOURCE: Record<string, string> = { pokemon: "the official Pokémon database", web: "a checklist found online", manual: "a checklist someone pasted", ai: "the AI's knowledge of this set, checked against scanned cards" };

/** Look at every card in a collection before deciding to track it. */
export default function SetPreview({ name }: { name: string }) {
  const router = useRouter();
  const { track, stage, busy: tracking } = useTrackSet();
  const [d, setD] = useState<Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "own" | "miss">("all");

  async function load(search: boolean, force = false) {
    setLoading(true); setError("");
    try {
      setD(await api<Data>(`/api/sets/preview?name=${encodeURIComponent(name)}${search ? "&search=1" : ""}${force ? "&force=1" : ""}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load the set");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(false); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [name]);

  const entries = d?.checklist?.entries ?? [];
  const owned = entries.filter((e) => e.card).length;
  const shown = useMemo(() => entries.filter((e) => (filter === "own" ? e.card : filter === "miss" ? !e.card : true)), [entries, filter]);
  const missingValue = entries.filter((e) => !e.card).reduce((n, e) => n + (e.est ?? 0), 0);

  async function startTracking() {
    setError("");
    const r = await track(name);
    if (r?.id) router.push(`/sets/${r.id}`);
    else setError(r?.error ?? "Couldn't start tracking that set");
  }

  if (!d) return error ? <p className="error">{error}</p> : <div className="scanning"><span className="spinner big" /></div>;

  return (
    <div className="stack">
      <div className="row" style={{ alignItems: "center", gap: 14 }}>
        {d.checklist && <Ring owned={owned} total={entries.length} size={64} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="small muted" style={{ margin: 0 }}>Preview — not tracked yet</p>
          <h1 style={{ fontSize: 24 }}>{name}</h1>
          <p className="small muted" style={{ margin: "2px 0 0" }}>
            {d.checklist
              ? <>You have <b style={{ color: "var(--text)" }}>{owned} of {entries.length}</b>{missingValue ? <> · ~{aud(missingValue, false)} to complete</> : null}</>
              : <>{d.cards.length} card{d.cards.length === 1 ? "" : "s"} in your vault</>}
          </p>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="row" style={{ gap: 8 }}>
        {d.trackedId ? (
          <Link href={`/sets/${d.trackedId}`} className="btn primary small">Open tracked set →</Link>
        ) : (
          <button className="btn primary small" onClick={startTracking} disabled={tracking || loading}>
            {tracking ? <><span className="spinner" /> {stage || "Tracking…"}</> : "Track this set"}
          </button>
        )}
        <span className="small muted">
          {d.checklist ? "Tracking keeps this list, lets you tick cards off, and adds rough values." : "Tracking finds the checklist and lets you tick cards off."}
        </span>
      </div>

      {d.checklist ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            From {SOURCE[d.checklist.source] ?? "a checklist"}{d.checklist.shared ? " in the shared library (no search used)" : ""}.
            {d.checklist.url?.startsWith("http") && <> <a href={d.checklist.url} target="_blank" rel="noreferrer">Source ↗</a></>}
          </p>
          {!!d.unmatched && (
            <div className="merge-hint row">
              <span style={{ flex: "1 1 220px" }}>
                <b>{d.unmatched} of your cards aren&apos;t on this checklist</b>
                <span className="muted small"> — it may only cover part of the set ({entries.length} cards).</span>
              </span>
              <button className="btn small" onClick={() => load(true, true)} disabled={loading}>{loading ? <span className="spinner" /> : "Look for a fuller list"}</button>
            </div>
          )}
          <nav className="seg" aria-label="Filter">
            {([["all", `All ${entries.length}`], ["own", `Have ${owned}`], ["miss", `Missing ${entries.length - owned}`]] as const).map(([k, label]) => (
              <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
            ))}
          </nav>
          <div className="ck-grid">
            {shown.map((e, i) => {
              const pic = e.card?.image ?? null;
              return (
                <div key={`${e.number}-${e.name}-${i}`} className="ck-cell">
                  {e.card ? (
                    <Link href={`/card/${e.card.id}`} className="ck-tile own" aria-label={`${e.number ? `#${e.number} ` : ""}${e.name}, owned`}>
                      {pic ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={pic} alt="" loading="lazy" /> : <span className="ck-plain">{e.name}</span>}
                      <span className="ck-mark" aria-hidden>✓</span>
                      {e.card.qty > 1 && <span className="ck-qty">×{e.card.qty}</span>}
                      {e.number && <span className="ck-no">{e.number}</span>}
                    </Link>
                  ) : (
                    <div className="ck-tile miss" aria-label={`${e.number ? `#${e.number} ` : ""}${e.name}, missing`}>
                      {e.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={e.image} alt="" loading="lazy" className="ghost" /> : <span className="ck-sil" />}
                      {e.number && <span className="ck-no">{e.number}</span>}
                    </div>
                  )}
                  <div className={`ck-cap ${e.card ? "o" : ""}`}>{e.name}{!e.card && e.est != null ? <span className="muted"> · {aud(e.est)}</span> : null}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <>
          <section className="panel stack">
            {d.notFound ? (
              <p className="small" style={{ margin: 0 }}>Couldn&apos;t find a checklist online for this set. Track it anyway and paste the checklist yourself on the set page (one card per line).</p>
            ) : (
              <>
                <b>No checklist for this set yet</b>
                <p className="small muted" style={{ margin: 0 }}>
                  It isn&apos;t in the approved list or shared library. An admin can add it under <b>Admin → Add a set</b> (Pokémon from the official database; others from a checklist link or CSV).
                </p>
                <details className="last-resort">
                  <summary>Last resort: search the web for this checklist</summary>
                  <p className="small muted" style={{ margin: "6px 0" }}>Uses up to 2 searches and reads whatever pages it finds — results can be incomplete or wrong.</p>
                  <button className="btn ghost small" onClick={() => load(true)} disabled={loading}>
                    {loading ? <><span className="spinner" /> Searching the web… (15–40 seconds)</> : "Search the web (last resort)"}
                  </button>
                </details>
              </>
            )}
          </section>
          {d.cards.length > 0 && (
            <>
              <h2 style={{ fontSize: 16 }}>Your cards in this collection</h2>
              <div className="ck-grid">
                {d.cards.map((c) => (
                  <div key={c.id} className="ck-cell">
                    <Link href={`/card/${c.id}`} className="ck-tile own">
                      {c.image ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.image} alt="" loading="lazy" /> : <span className="ck-plain">{c.name}</span>}
                      {c.qty > 1 && <span className="ck-qty">×{c.qty}</span>}
                      {c.number && <span className="ck-no">{c.number}</span>}
                    </Link>
                    <div className="ck-cap o">{c.name}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

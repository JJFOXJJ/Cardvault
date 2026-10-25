"use client";

import { useState } from "react";
import { api } from "@/lib/client";

export type Candidate = { url: string; thumb: string; source?: string; title?: string; origin: string };

type Props = {
  candidates: Candidate[];
  selected: string | null;               // candidate url, or "own" for the owner's photo
  onSelect: (c: Candidate | "own") => void;
  ownPhoto?: string | null;
  initialQuery?: string;
  onCandidates?: (c: Candidate[]) => void;
};

export default function ImagePicker({ candidates, selected, onSelect, ownPhoto, initialQuery = "", onCandidates }: Props) {
  const [q, setQ] = useState(initialQuery);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const res = await api<{ candidates: Candidate[] }>(`/api/images?q=${encodeURIComponent(q)}`);
      if (!res.candidates.length) setErr("No pictures found — try different words.");
      onCandidates?.(res.candidates);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Search failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="picker">
        {candidates.map((c) => (
          <button key={c.url} type="button" className={`pick ${selected === c.url ? "on" : ""}`} onClick={() => onSelect(c)} title={c.title}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={c.thumb} alt={c.title ?? "Card image"} loading="lazy" referrerPolicy="no-referrer" />
            {c.origin === "pokemontcg" && <span className="tag">Official</span>}
          </button>
        ))}
        {ownPhoto && (
          <button type="button" className={`pick ${selected === "own" ? "on" : ""}`} onClick={() => onSelect("own")} title="Use my photo">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ownPhoto} alt="My photo" style={{ objectFit: "cover" }} />
            <span className="tag">My photo</span>
          </button>
        )}
      </div>
      <form onSubmit={search} className="row">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search for a different picture" style={{ flex: 1, width: "auto" }} />
        <button className="btn small" disabled={busy}>{busy ? <span className="spinner" /> : "Search"}</button>
      </form>
      {err && <p className="small muted">{err}</p>}
    </div>
  );
}

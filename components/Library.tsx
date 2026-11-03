"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Stats = { available: boolean; sets: number; pictures: number; prices: number };

/** Admin: what's in the shared card library, and a one-off fill from existing cards. */
export default function Library({ saved }: { saved: number }) {
  const [s, setS] = useState<Stats | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const load = () => api<Stats>("/api/admin/library").then(setS).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function fill() {
    setBusy(true); setError(""); setMsg("");
    const t = { sets: 0, prices: 0, pictures: 0 };
    try {
      for (let i = 0; i < 30; i++) {
        const r = await api<{ sets: number; prices: number; pictures: number; picturesLeft: number }>("/api/admin/library", { method: "POST" });
        t.sets += r.sets; t.prices += r.prices; t.pictures += r.pictures;
        setMsg(r.picturesLeft ? `Copying pictures… ${r.picturesLeft} to go` : "");
        if (!r.picturesLeft) break;
      }
      setMsg(t.sets + t.prices + t.pictures
        ? `Added ${t.sets} set checklist${t.sets === 1 ? "" : "s"}, ${t.prices} price${t.prices === 1 ? "" : "s"} and ${t.pictures} picture${t.pictures === 1 ? "" : "s"}.`
        : "Nothing new to add — the library already has everything.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't fill the library");
      setMsg("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ fontSize: 18 }}>Shared card library</h2>
        <span className="spacer" />
        {s?.available && <button className="btn small" onClick={fill} disabled={busy}>{busy ? <><span className="spinner" /> Filling…</> : "Fill from existing cards"}</button>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Anything found online — a set&apos;s checklist, a clean card picture, a card&apos;s price — is saved once and reused for everyone, so the same card never costs
        a search twice. Prices are re-checked after 30 days. Your own photos and your cards stay private.
      </p>
      {s && !s.available ? (
        <p className="error" style={{ margin: 0 }}>
          The library needs a quick database update. In Supabase, open <b>SQL Editor</b>, run <code>supabase/migrations/006_shared_library.sql</code> from your GitHub repo, then refresh.
        </p>
      ) : s ? (
        <div className="usage-stats">
          <div><b>{s.sets}</b><span>set checklists</span></div>
          <div><b>{s.pictures}</b><span>card pictures</span></div>
          <div><b>{s.prices}</b><span>card prices · {saved} searches saved this month</span></div>
        </div>
      ) : <span className="spinner" />}
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
    </section>
  );
}

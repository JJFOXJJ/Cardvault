"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type B = { name: string; created_at: string | null; size: number | null };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Sydney", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "";
const size = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Admin: daily backups list, download and "back up now". */
export default function Backups() {
  const [list, setList] = useState<B[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const load = () => api<{ backups: B[] }>("/api/admin/backup").then((d) => setList(d.backups)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function now() {
    setBusy(true); setError(""); setMsg("");
    try {
      const r = await api<{ cards: number; profiles: number }>("/api/admin/backup", { method: "POST" });
      setMsg(`Backed up ${r.cards} card records from ${r.profiles} profile${r.profiles === 1 ? "" : "s"}.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Backup failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stack">
      <div className="row">
        <h2 style={{ fontSize: 18 }}>Backups</h2>
        <span className="spacer" />
        <button className="btn small" onClick={now} disabled={busy}>{busy ? <><span className="spinner" /> Backing up…</> : "Back up now"}</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Every night around 4am the app saves a copy of everyone&apos;s card details to a private folder in Supabase (the last 14 days are kept). The same
        daily job keeps the free database awake so it never pauses. Pictures aren&apos;t copied — they stay where they are.
      </p>
      {msg && <p className="notice" style={{ margin: 0 }}>{msg}</p>}
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {list == null ? (
        <span className="spinner" />
      ) : !list.length ? (
        <p className="small muted" style={{ margin: 0 }}>No backups yet — the first one runs tonight, or tap “Back up now”.</p>
      ) : (
        <div className="coll-list">
          {list.slice(0, 7).map((b) => (
            <div key={b.name} className="coll-row" style={{ cursor: "default", padding: "8px 0" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{b.name.replace("cardvault-", "").replace(".json", "")}</div>
                <div className="small muted">{[when(b.created_at), size(b.size)].filter(Boolean).join(" · ")}</div>
              </div>
              <a className="btn ghost small" href={`/api/admin/backup?file=${encodeURIComponent(b.name)}`}>Download</a>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

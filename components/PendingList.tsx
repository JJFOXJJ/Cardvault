"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, aud } from "@/lib/client";
import { pushAdded } from "@/lib/session-added";
import JustAdded from "./JustAdded";

type Item = { id: string; photo_url: string | null; back_photo_url: string | null; hint: string | null; last_error: string | null; created_at: string };
type RowState = { state: "idle" | "working" | "done" | "error"; note?: string };

export default function PendingList({ items }: { items: Item[] }) {
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const stopRef = useRef(false);

  const setRow = (id: string, r: RowState) => setRows((prev) => ({ ...prev, [id]: r }));

  async function identifyAll() {
    const todo = items.filter((i) => rows[i.id]?.state !== "done");
    if (!todo.length) return;
    setRunning(true);
    stopRef.current = false;
    setProgress({ done: 0, total: todo.length });
    let consecutiveFailures = 0;

    for (let n = 0; n < todo.length; n++) {
      if (stopRef.current) break;
      const item = todo[n];
      setRow(item.id, { state: "working" });
      try {
        const r = await api<{ name: string; confidence: string; aud_mid: number | null }>(`/api/pending/${item.id}/auto`, { method: "POST" });
        setRow(item.id, { state: "done", note: `${r.name} · ${aud(r.aud_mid)}${r.confidence === "low" ? " · check this one" : ""}` });
        pushAdded(item.id);
        consecutiveFailures = 0;
      } catch (e) {
        setRow(item.id, { state: "error", note: e instanceof Error ? e.message : "Failed" });
        // If Gemini's free tier is struggling, pause rather than burning through the list.
        if (++consecutiveFailures >= 3) {
          stopRef.current = true;
          setRow("__stop", { state: "error", note: "Stopped after 3 failures in a row — Gemini's free tier may be at its limit. Try again later; nothing is lost." });
        } else {
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
      setProgress({ done: n + 1, total: todo.length });
      // A short gap between cards keeps us inside free-tier per-minute limits.
      if (n < todo.length - 1 && !stopRef.current) await new Promise((r) => setTimeout(r, 3000));
    }
    setRunning(false);
    router.refresh();
  }

  async function remove(id: string) {
    if (!confirm("Delete this saved photo?")) return;
    try {
      await api(`/api/cards/${id}`, { method: "DELETE" });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const doneCount = Object.entries(rows).filter(([k, r]) => k !== "__stop" && r.state === "done").length;

  if (!items.length) {
    return (
      <div className="stack">
        <div className="empty">
          <h1>Nothing waiting</h1>
          <p className="muted">Cards you save for later will appear here.</p>
          <Link href="/add" className="btn primary" style={{ marginTop: 10 }}>Add cards</Link>
        </div>
        <JustAdded title="Just filed" />
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <div>
          <h1>Waiting list</h1>
          <p className="muted" style={{ margin: "4px 0 0" }}>{items.length} saved photo{items.length === 1 ? "" : "s"} to identify.</p>
        </div>
        <span className="spacer" />
        <Link href="/add" className="btn small">+ Add more</Link>
      </div>

      <section className="panel stack">
        <div className="row">
          <div style={{ flex: "1 1 240px" }}>
            <b>Identify all automatically</b>
            <p className="small muted" style={{ margin: "2px 0 0" }}>
              Works through the list one card at a time and files each one with the best picture found. Keep this page open. Low-confidence results are flagged so you can check them.
            </p>
          </div>
          {running ? (
            <button className="btn" onClick={() => (stopRef.current = true)}>Stop</button>
          ) : (
            <button className="btn primary" onClick={identifyAll}>{doneCount ? "Continue" : "Identify all"}</button>
          )}
        </div>
        {(running || progress.total > 0) && (
          <>
            <div className="progress"><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
            <span className="small muted">{progress.done} of {progress.total} processed{running ? "…" : ""}</span>
          </>
        )}
        {rows.__stop && <p className="error" style={{ margin: 0 }}>{rows.__stop.note}</p>}
      </section>

      <JustAdded title="Just filed" lockLinks={running} />

      <p className="small muted" style={{ margin: 0 }}>Or tap a card to identify it yourself and choose the picture.</p>

      <div className="pending-grid">
        {items.filter((i) => rows[i.id]?.state !== "done").map((i) => {
          const r = rows[i.id];
          return (
            <div key={i.id} className="pending-item">
              <Link href={r?.state === "done" ? "/" : `/add?pending=${i.id}`} className="art" style={{ display: "block" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {i.photo_url && <img src={i.photo_url} alt="Saved card photo" loading="lazy" />}
                {r?.state === "working" && <span className="state"><span className="spinner" style={{ width: 12, height: 12 }} /> Identifying…</span>}
                {r?.state === "done" && <span className="state" style={{ color: "var(--good)" }}>✓ Filed</span>}
              </Link>
              {r?.note ? (
                <div className={r.state === "error" ? "err" : "small"}>{r.note}</div>
              ) : i.last_error ? (
                <div className="err">Last try failed: {i.last_error}</div>
              ) : (
                <div className="small muted">{i.hint || new Date(i.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}{i.back_photo_url ? " · front + back" : ""}</div>
              )}
              {!running && r?.state !== "done" && (
                <button className="btn ghost small danger" style={{ justifySelf: "start", padding: "2px 0" }} onClick={() => remove(i.id)}>Delete</button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";

type Data = {
  needsMigration?: boolean;
  link: { token: string; showValues: boolean; createdAt: string } | null;
  sharedWith: { id: string; name: string; showValues: boolean }[];
  sharedWithMe: { id: string; name: string }[];
  others: { id: string; name: string }[];
};

export default function Sharing({ myId }: { myId: string }) {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pick, setPick] = useState("");
  const [pickValues, setPickValues] = useState(true);
  const [origin, setOrigin] = useState("");
  const [canShare, setCanShare] = useState(false);

  const load = () => api<Data>("/api/sharing").then(setD).catch((e) => setError(e.message));
  useEffect(() => { setOrigin(window.location.origin); setCanShare(typeof navigator.share === "function"); load(); }, []);

  async function change(key: string, body: Record<string, unknown>, ok = "") {
    setBusy(key); setError(""); setNotice("");
    try {
      await api("/api/sharing", { method: "POST", body: JSON.stringify(body) });
      await load();
      if (ok) setNotice(ok);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!d) return error ? <p className="error">{error}</p> : <div className="scanning"><span className="spinner big" /></div>;
  if (d.needsMigration) {
    return (
      <div className="stack">
        <h1>Sharing</h1>
        <p className="error">
          Sharing needs a quick database update. In Supabase, open <b>SQL Editor</b>, run <code>supabase/migrations/007_sharing.sql</code> from your GitHub repo, then refresh.
        </p>
      </div>
    );
  }

  const url = d.link ? `${origin}/share/${d.link.token}` : "";
  const notYet = d.others.filter((o) => !d.sharedWith.some((s) => s.id === o.id));

  async function copy() {
    try { await navigator.clipboard.writeText(url); setNotice("Link copied."); } catch { setError("Couldn't copy — select the link and copy it."); }
  }
  async function shareNative() {
    try { await navigator.share({ title: "My card collection", url }); } catch { /* cancelled */ }
  }

  return (
    <div className="stack">
      <div>
        <h1>Sharing</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Let others see your collection, sets, wishlist (missing cards) and spares — read-only. Nobody can change anything. Your notes, the backs of your photos and cards waiting to be identified are never shown.
        </p>
      </div>
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel share-card">
        <h2 style={{ fontSize: 18 }}>Read-only link</h2>
        <p className="small muted" style={{ margin: 0 }}>Anyone with the link can look — no PIN needed. Turn it off any time and it stops working straight away.</p>
        {d.link ? (
          <>
            <div className="share-url">
              <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Share link" />
              <button className="btn small primary" onClick={copy}>Copy</button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              {canShare && <button className="btn small" onClick={shareNative}>Share…</button>}
              <a className="btn small ghost" href={url} target="_blank" rel="noreferrer">Open</a>
              <span className="spacer" />
              <button className="btn small ghost" disabled={!!busy} onClick={() => window.confirm("Make a new link? The current link will stop working.") && change("regen", { kind: "link", action: "regenerate", showValues: d.link!.showValues }, "New link made — the old one no longer works.")}>New link</button>
              <button className="btn small ghost danger" disabled={!!busy} onClick={() => change("off", { kind: "link", action: "off" }, "Link turned off.")}>Turn off</button>
            </div>
            <label className="switch-row">
              <input type="checkbox" checked={d.link.showValues} disabled={!!busy} onChange={(e) => change("lv", { kind: "link", action: "values", showValues: e.target.checked })} />
              Show values on the link
            </label>
          </>
        ) : (
          <div className="row">
            <button className="btn primary small" disabled={!!busy} onClick={() => change("create", { kind: "link", action: "create" })}>{busy === "create" ? <span className="spinner" /> : "Create a link"}</button>
          </div>
        )}
      </section>

      <section className="panel share-card">
        <h2 style={{ fontSize: 18 }}>Share with people in Card Vault</h2>
        <p className="small muted" style={{ margin: 0 }}>They&apos;ll see your collection under <b>Shared with you</b>, plus trade matches: your spares they&apos;re missing, and theirs you&apos;re missing.</p>
        {notYet.length ? (
          <form className="row" onSubmit={async (e) => { e.preventDefault(); if (pick && await change("add", { kind: "person", action: "add", profileId: pick, showValues: pickValues }, "Shared.")) setPick(""); }}>
            <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ flex: "1 1 160px", width: "auto" }} aria-label="Choose a profile">
              <option value="">Choose someone…</option>
              {notYet.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <label className="switch-row small"><input type="checkbox" checked={pickValues} onChange={(e) => setPickValues(e.target.checked)} /> Show values</label>
            <button className="btn primary small" disabled={!pick || !!busy}>Share</button>
          </form>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>{d.others.length ? "You're sharing with everyone." : "There's nobody else in Card Vault yet."}</p>
        )}
        {!!d.sharedWith.length && (
          <div className="coll-list">
            {d.sharedWith.map((s) => (
              <div key={s.id} className="coll-row" style={{ cursor: "default", padding: "8px 0", flexWrap: "wrap" }}>
                <span className="avatar small">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="t" style={{ flex: 1 }}>{s.name}</span>
                <label className="switch-row small">
                  <input type="checkbox" checked={s.showValues} disabled={!!busy} onChange={(e) => change(`v-${s.id}`, { kind: "person", action: "values", profileId: s.id, showValues: e.target.checked })} />
                  Values
                </label>
                <button className="btn ghost small danger" disabled={!!busy} onClick={() => change(`r-${s.id}`, { kind: "person", action: "remove", profileId: s.id }, `Stopped sharing with ${s.name}.`)}>Stop</button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="panel share-card">
        <h2 style={{ fontSize: 18 }}>Shared with you</h2>
        {d.sharedWithMe.length ? (
          <div className="coll-list">
            {d.sharedWithMe.map((s) => (
              <Link key={s.id} href={`/shared/${s.id}`} className="coll-row" style={{ padding: "8px 0" }}>
                <span className="avatar small">{s.name.slice(0, 1).toUpperCase()}</span>
                <span className="t" style={{ flex: 1 }}>{s.name}&apos;s collection</span>
                <span className="small" style={{ color: "var(--cyan)" }}>View · trade matches →</span>
              </Link>
            ))}
          </div>
        ) : <p className="small muted" style={{ margin: 0 }}>Nobody has shared with you yet.</p>}
      </section>

      <Link href={`/shared/${myId}`} className="btn small" style={{ justifySelf: "start" }}>Preview what others see →</Link>
    </div>
  );
}

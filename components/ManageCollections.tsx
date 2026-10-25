"use client";

import { useEffect, useMemo, useState } from "react";
import { api, aud } from "@/lib/client";
import { similarGroups } from "@/lib/collections";

type Count = { name: string; cards: number; value: number };
const UNSORTED = "\u0000unsorted";

export default function ManageCollections() {
  const [rows, setRows] = useState<Count[] | null>(null);
  const [unsorted, setUnsorted] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [mergeName, setMergeName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const d = await api<{ collections: Count[]; unsorted: number }>("/api/collections");
    setRows(d.collections);
    setUnsorted(d.unsorted);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  const groups = useMemo(() => similarGroups((rows ?? []).map((r) => r.name)), [rows]);
  const countOf = (n: string) => (n === UNSORTED ? unsorted : rows?.find((r) => r.name === n)?.cards ?? 0);
  const label = (n: string) => (n === UNSORTED ? "Unsorted" : n);

  const visible = (rows ?? []).filter((r) => r.name.toLowerCase().includes(filter.trim().toLowerCase()));

  function toggle(name: string) {
    setNotice("");
    setSelected((s) => {
      const next = s.includes(name) ? s.filter((x) => x !== name) : [...s, name];
      // Default the merged name to the biggest selected collection.
      const biggest = [...next].filter((n) => n !== UNSORTED).sort((a, b) => countOf(b) - countOf(a))[0];
      setMergeName(biggest ?? "");
      return next;
    });
  }

  async function apply(from: string[], to: string, message: string) {
    if (!to.trim()) return setError("Give the collection a name");
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await api<{ updated: number }>("/api/collections", {
        method: "PATCH",
        body: JSON.stringify({ from: from.map((f) => (f === UNSORTED ? null : f)), to: to.trim() }),
      });
      setNotice(`${message} (${r.updated} card${r.updated === 1 ? "" : "s"} updated)`);
      setSelected([]); setMergeName(""); setEditing(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!rows) return <div className="scanning"><span className="spinner big" /></div>;

  return (
    <div className="stack">
      <div>
        <h1>Collections</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Tick two or more to merge them, or tap Rename. Renaming one to the same name as another also merges them.
        </p>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {groups.length > 0 && (
        <section className="panel stack">
          <b>Possible duplicates</b>
          {groups.map((g) => (
            <div key={g.join("|")} className="row" style={{ justifyContent: "space-between" }}>
              <span className="small">{g.map((n) => `${n} (${countOf(n)})`).join("  ·  ")}</span>
              <button className="btn small" onClick={() => { setSelected(g); setMergeName([...g].sort((a, b) => countOf(b) - countOf(a))[0]); setNotice(""); }} disabled={busy}>
                Select these
              </button>
            </div>
          ))}
        </section>
      )}

      {selected.length >= 2 && (
        <section className="panel stack sticky-merge">
          <b>Merge {selected.length} collections ({selected.reduce((n, s) => n + countOf(s), 0)} cards)</b>
          <label className="field">
            <span>Name for the merged collection</span>
            <input value={mergeName} onChange={(e) => setMergeName(e.target.value)} list="cv-merge-names" />
            <datalist id="cv-merge-names">{selected.filter((s) => s !== UNSORTED).map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => apply(selected, mergeName, `Merged into "${mergeName.trim()}"`)} disabled={busy || !mergeName.trim()}>
              {busy ? <><span className="spinner" /> Merging…</> : "Merge"}
            </button>
            <button className="btn ghost" onClick={() => setSelected([])} disabled={busy}>Clear selection</button>
          </div>
        </section>
      )}

      {rows.length > 8 && <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a collection…" />}

      <section className="panel coll-list">
        {[...visible.map((r) => r.name), ...(unsorted && !filter ? [UNSORTED] : [])].map((name) => {
          const r = rows.find((x) => x.name === name);
          return (
            <div key={name} className={`coll-row ${selected.includes(name) ? "on" : ""}`}>
              <input type="checkbox" checked={selected.includes(name)} onChange={() => toggle(name)} aria-label={`Select ${label(name)}`} />
              {editing === name ? (
                <form className="row" style={{ flex: 1 }} onSubmit={(e) => { e.preventDefault(); apply([name], editName, `Renamed to "${editName.trim()}"`); }}>
                  <input value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus style={{ flex: 1, width: "auto" }} />
                  <button className="btn primary small" disabled={busy || !editName.trim()}>Save</button>
                  <button type="button" className="btn ghost small" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <>
                  <div style={{ flex: 1, minWidth: 0 }} onClick={() => toggle(name)}>
                    <div className="t">{label(name)}</div>
                    <div className="small muted">{countOf(name)} card{countOf(name) === 1 ? "" : "s"}{r ? ` · ${aud(r.value, false)}` : ""}</div>
                  </div>
                  <button className="btn ghost small" onClick={() => { setEditing(name); setEditName(name === UNSORTED ? "" : name); }} disabled={busy}>
                    {name === UNSORTED ? "Name…" : "Rename"}
                  </button>
                </>
              )}
            </div>
          );
        })}
        {!rows.length && !unsorted && <p className="muted">No collections yet.</p>}
      </section>
    </div>
  );
}

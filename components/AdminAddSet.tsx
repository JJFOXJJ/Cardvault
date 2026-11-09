"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, CATEGORIES } from "@/lib/client";

type PSet = { id: string; name: string; displayName: string; series: string | null; year: string | null; total: number | null; logo: string | null; symbol: string | null; source: "pokemontcg" | "tcgdex"; added: boolean; cardsSaved: number };
type Entry = { number: string | null; name: string; subset: string | null };

export default function AdminAddSet() {
  const [tab, setTab] = useState<"pokemon" | "other">("pokemon");
  return (
    <div className="stack">
      <div>
        <p className="small muted" style={{ margin: 0 }}><Link href="/admin/sets">← Set list</Link></p>
        <h1>Add a set</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Adds the set and its full checklist to the approved set list and the shared library, for everyone. Scans then match cards to this checklist —
          no web searches needed.
        </p>
      </div>
      <nav className="seg" aria-label="Kind of set">
        <button className={tab === "pokemon" ? "on" : ""} onClick={() => setTab("pokemon")}>Pokémon</button>
        <button className={tab === "other" ? "on" : ""} onClick={() => setTab("other")}>Other sets (sports, Marvel, Simpsons…)</button>
      </nav>
      {tab === "pokemon" ? <PokemonTab /> : <OtherTab />}
    </div>
  );
}

function PokemonTab() {
  const [sets, setSets] = useState<PSet[] | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const load = () => api<{ sets: PSet[]; source: string | null }>("/api/admin/sets/add").then((d) => { setSets(d.sets); setSource(d.source); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (sets ?? []).filter((s) => words.every((w) => `${s.name} ${s.series ?? ""} ${s.year ?? ""} ${s.id}`.toLowerCase().includes(w))).slice(0, 120);
  }, [sets, q]);

  async function add(s: PSet) {
    setBusy(s.id); setError(""); setToast("");
    try {
      const r = await api<{ name: string; cards: number; profilesUpdated: number }>("/api/admin/sets/add", { method: "POST", body: JSON.stringify({ action: "pokemon", id: s.id, source: s.source }) });
      setToast(`Added “${r.name}” — ${r.cards} cards with pictures${r.profilesUpdated ? `; updated for ${r.profilesUpdated} tracking profile${r.profilesUpdated === 1 ? "" : "s"}` : ""}.`);
      setSets((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, added: true, cardsSaved: r.cards } : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that set");
    } finally {
      setBusy("");
    }
  }

  if (!sets) return error ? <p className="error">{error}</p> : <div className="scanning"><span className="spinner big" /> Loading every Pokémon set…</div>;
  return (
    <div className="stack">
      <p className="small muted" style={{ margin: 0 }}>
        {sets.length} sets from {source === "tcgdex" ? "TCGdex (backup source)" : "the Pokémon TCG API"}. Adding a set loads every card with its official picture
        {source === "tcgdex" ? "" : " and a market price"}.
      </p>
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets — e.g. “151”, “Base”, “Evolving Skies”, “2023”" />
      {toast && <p className="notice">{toast}</p>}
      {error && <p className="error">{error}</p>}
      <section className="panel coll-list" style={{ padding: 0 }}>
        {!shown.length && <p className="muted" style={{ padding: 14, margin: 0 }}>No sets match.</p>}
        {shown.map((s) => (
          <div key={`${s.source}-${s.id}`} className="pset">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {s.symbol ? <img src={s.symbol} alt="" className="pset-sym" loading="lazy" /> : <span className="pset-sym" />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="t">{s.name}</div>
              <div className="small muted">{[s.series, s.year, s.total ? `${s.total} cards` : null].filter(Boolean).join(" · ")}</div>
            </div>
            {s.added ? (
              <button className="btn ghost small" onClick={() => add(s)} disabled={!!busy} title="Load it again (e.g. new prices)">{busy === s.id ? <span className="spinner" /> : `Added ✓ ${s.cardsSaved}`}</button>
            ) : (
              <button className="btn primary small" onClick={() => add(s)} disabled={!!busy}>{busy === s.id ? <><span className="spinner" /> Adding…</> : "Add"}</button>
            )}
          </div>
        ))}
      </section>
      {(sets.length > shown.length) && <p className="small muted" style={{ margin: 0 }}>Showing {shown.length} of {sets.length} — search to narrow it down.</p>}
    </div>
  );
}

function OtherTab() {
  const [name, setName] = useState("");
  const [det, setDet] = useState({ category: "", year: "", manufacturer: "" });
  const [mode, setMode] = useState<"link" | "csv">("link");
  const [url, setUrl] = useState("");
  const [csv, setCsv] = useState<{ name: string; text: string } | null>(null);
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [source, setSource] = useState<"link" | "csv" | "web">("link");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [names, setNames] = useState<string[]>([]);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ rows: { name: string; status: string }[] }>("/api/admin/sets").then((d) => setNames(d.rows.map((r) => r.name))).catch(() => {});
  }, []);

  async function read(how: "link" | "csv" | "web") {
    setBusy(how); setError(""); setToast(""); setEntries(null);
    try {
      const r = await api<{ entries: Entry[]; notes: string[]; warnings: string[] }>("/api/admin/sets/add", {
        method: "POST", body: JSON.stringify({ action: "preview", mode: how, name, url: how === "link" ? url.trim() : undefined, csv: how === "csv" ? csv?.text : undefined }),
      });
      setEntries(r.entries.map(({ number, name, subset }) => ({ number, name, subset })));
      setNotes(r.notes ?? []); setWarnings(r.warnings ?? []); setSource(how);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that checklist");
    } finally {
      setBusy("");
    }
  }

  async function save() {
    if (!entries) return;
    setBusy("save"); setError("");
    try {
      const r = await api<{ name: string; cards: number; profilesUpdated: number }>("/api/admin/sets/add", {
        method: "POST", body: JSON.stringify({ action: "save", name, ...det, entries, checklistSource: source, url: source === "link" ? url.trim() : undefined }),
      });
      setToast(`Saved “${r.name}” with ${r.cards} cards to the approved list and shared library${r.profilesUpdated ? `; updated for ${r.profilesUpdated} tracking profile${r.profilesUpdated === 1 ? "" : "s"}` : ""}.`);
      setEntries(null); setUrl(""); setCsv(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy("");
    }
  }

  const edit = (i: number, k: keyof Entry, v: string) => setEntries((l) => l!.map((e, j) => (j === i ? { ...e, [k]: v || null } : e)));
  const subsets = entries ? [...new Set(entries.map((e) => e.subset ?? "Base set"))] : [];

  return (
    <div className="stack">
      {toast && <p className="notice">{toast}</p>}
      {error && <p className="error">{error}</p>}
      <section className="panel stack">
        <label className="field">
          <span>Set name (as it should appear for everyone)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} list="known-sets" placeholder="e.g. 1993-94 SkyBox Premium" />
          <datalist id="known-sets">{names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <div className="grid-3">
          <select value={det.category} onChange={(e) => setDet({ ...det, category: e.target.value })} aria-label="Category">
            <option value="">Category…</option>
            {CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input value={det.year} onChange={(e) => setDet({ ...det, year: e.target.value })} placeholder="Year, e.g. 1993-94" />
          <input value={det.manufacturer} onChange={(e) => setDet({ ...det, manufacturer: e.target.value })} placeholder="Maker, e.g. SkyBox" />
        </div>
        <nav className="seg" aria-label="Checklist source">
          <button className={mode === "link" ? "on" : ""} onClick={() => setMode("link")}>Checklist link</button>
          <button className={mode === "csv" ? "on" : ""} onClick={() => setMode("csv")}>CSV file</button>
        </nav>
        {mode === "link" ? (
          <div className="row">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… page that lists the whole set" inputMode="url" style={{ flex: 1, width: "auto" }} />
            <button className="btn primary small" disabled={!!busy || !name.trim() || !/^https?:\/\//.test(url.trim())} onClick={() => read("link")}>
              {busy === "link" ? <><span className="spinner" /> Reading…</> : "Read checklist"}
            </button>
          </div>
        ) : (
          <div className="row">
            <button className="btn small" onClick={() => file.current?.click()}>{csv ? `📄 ${csv.name}` : "Choose CSV file"}</button>
            <input ref={file} type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" hidden onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              if (f.size > 2_000_000) { setError("That file is too big for a checklist (over 2 MB)."); return; }
              setCsv({ name: f.name, text: await f.text() });
            }} />
            <span className="spacer" />
            <button className="btn primary small" disabled={!!busy || !name.trim() || !csv} onClick={() => read("csv")}>
              {busy === "csv" ? <><span className="spinner" /> Reading…</> : "Read checklist"}
            </button>
          </div>
        )}
        <p className="small muted" style={{ margin: 0 }}>
          CSV: one card per row with columns like <b>Number, Name</b> (and optionally <b>Subset</b> for inserts). A file with a set column (e.g. a collection export) keeps only this set&apos;s rows.
        </p>
        <details className="last-resort">
          <summary>Last resort: search the web for this checklist</summary>
          <p className="small muted" style={{ margin: "6px 0" }}>Uses up to 2 searches and reads whatever pages it finds — the list can be incomplete or wrong. You&apos;ll still check it before saving.</p>
          <button className="btn ghost small" disabled={!!busy || !name.trim()} onClick={() => read("web")}>{busy === "web" ? <><span className="spinner" /> Searching the web…</> : "Search the web (last resort)"}</button>
        </details>
      </section>

      {entries && (
        <section className="panel stack">
          <div className="row">
            <h2 style={{ fontSize: 18 }}>Check the list</h2>
            <span className="spacer" />
            <b>{entries.length} cards</b>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{subsets.length > 1 ? `Groups: ${subsets.join(", ")}. ` : ""}Fix anything that&apos;s wrong, then save. Nothing is saved until you do.</p>
          {[...notes, ...warnings].map((n) => <p key={n} className="small" style={{ margin: 0, color: "var(--accent)" }}>• {n}</p>)}
          <div className="ck-review">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Subset</th><th></th></tr></thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={i}>
                    <td><input value={e.number ?? ""} onChange={(ev) => edit(i, "number", ev.target.value)} aria-label="Number" /></td>
                    <td><input value={e.name} onChange={(ev) => edit(i, "name", ev.target.value)} aria-label="Name" /></td>
                    <td><input value={e.subset ?? ""} onChange={(ev) => edit(i, "subset", ev.target.value)} aria-label="Subset" placeholder="—" /></td>
                    <td><button className="btn ghost small" aria-label="Remove" onClick={() => setEntries((l) => l!.filter((_, j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn ghost small" onClick={() => setEntries((l) => [...l!, { number: null, name: "", subset: null }])}>+ Add a row</button>
            <span className="spacer" />
            <button className="btn ghost small" onClick={() => setEntries(null)} disabled={!!busy}>Cancel</button>
            <button className="btn primary small" onClick={save} disabled={!!busy || !entries.some((e) => e.name.trim())}>
              {busy === "save" ? <><span className="spinner" /> Saving…</> : "Save to shared library"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

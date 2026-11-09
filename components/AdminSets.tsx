"use client";

import { useEffect, useMemo, useState } from "react";
import { api, CATEGORIES } from "@/lib/client";

type Cat = { id: string; name: string; aliases: string[]; category: string | null; year: string | null; manufacturer: string | null; checklist_source: string | null; checklist_url: string | null; checklist_updated_at: string | null; checklistCount: number };
type Row = { name: string; profiles: number; cards: number; tracked: number; status: "approved" | "rename" | "pending"; approvedName: string | null; catalog: Cat | null };
type Data = { available: boolean; rows: Row[]; duplicates: { names: string[]; suggested: string }[] };
type Filter = "todo" | "approved" | "all";

const SOURCE: Record<string, string> = { link: "from a checklist page", web: "found online", pasted: "typed/pasted", pokemon: "Pokémon database", ai: "AI knowledge", approved: "approved", manual: "pasted" };
const people = (r: { profiles: number; cards: number }) => `${r.cards} card${r.cards === 1 ? "" : "s"} · ${r.profiles} profile${r.profiles === 1 ? "" : "s"}`;

export default function AdminSets() {
  const [d, setD] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState("");
  const [filter, setFilter] = useState<Filter>("todo");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);

  const load = () => api<Data>("/api/admin/sets").then(setD).catch((e) => setError(e.message));
  useEffect(() => { load(); try { setDismissed(JSON.parse(localStorage.getItem("cv_admin_notdup") || "[]")); } catch { /* ignore */ } }, []);

  async function act(key: string, body: Record<string, unknown>, ok: (r: Record<string, unknown>) => string) {
    setBusy(key); setError(""); setToast("");
    try {
      const r = await api<Record<string, unknown>>("/api/admin/sets", { method: "POST", body: JSON.stringify(body) });
      setToast(ok(r));
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy("");
    }
  }

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (d?.rows ?? []).filter((r) => (filter === "all" || (filter === "approved" ? r.status === "approved" : r.status !== "approved")) && (!needle || r.name.toLowerCase().includes(needle)));
  }, [d, filter, q]);
  const approvedNames = useMemo(() => (d?.rows ?? []).filter((r) => r.status === "approved").map((r) => r.name), [d]);

  if (!d) return error ? <p className="error">{error}</p> : <div className="scanning"><span className="spinner big" /></div>;
  if (!d.available) {
    return (
      <div className="stack">
        <h1>Set list</h1>
        <p className="error">The approved set list needs a quick database update. In Supabase, open <b>SQL Editor</b>, run <code>supabase/migrations/008_set_catalog.sql</code> from your GitHub repo, then refresh.</p>
      </div>
    );
  }

  const counts = { approved: d.rows.filter((r) => r.status === "approved").length, todo: d.rows.filter((r) => r.status !== "approved").length };
  const dups = d.duplicates.filter((g) => !dismissed.includes([...g.names].sort().join("|")));
  const notDup = (g: { names: string[] }) => {
    const next = [...dismissed, [...g.names].sort().join("|")];
    setDismissed(next);
    try { localStorage.setItem("cv_admin_notdup", JSON.stringify(next)); } catch { /* ignore */ }
  };
  const rowOf = (n: string) => d.rows.find((r) => r.name === n);

  return (
    <div className="stack">
      <div>
        <div className="row"><h1>Set list</h1><span className="spacer" /><a href="/admin/sets/add" className="btn primary small">+ Add a set</a></div>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          One standard name per set, for everyone. Merging or renaming moves everyone&apos;s cards to the approved name — nothing else on their cards changes.
          New names from scans show here as <b>pending</b>.
        </p>
      </div>
      <div className="admin-stats">
        <div className="stat"><b>{counts.approved}</b><span>Approved sets</span></div>
        <div className="stat"><b>{counts.todo}</b><span>Pending names</span></div>
        <div className="stat"><b>{dups.length}</b><span>Possible duplicates</span></div>
      </div>
      {toast && <p className="notice">{toast}</p>}
      {error && <p className="error">{error}</p>}

      {dups.length > 0 && (
        <section className="stack" style={{ gap: 10 }}>
          <h2 style={{ fontSize: 17 }}>Possible duplicates</h2>
          {dups.map((g) => <DupGroup key={g.names.join("|")} g={g} rowOf={rowOf} busy={!!busy} onNotDup={() => notDup(g)}
            onMerge={(target) => act(`m-${g.names[0]}`, { action: "merge", names: g.names, target }, (r) => `Merged into “${r.name}” — ${r.cards} cards moved.`)} />)}
        </section>
      )}

      <div className="aset-tools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets…" />
        <nav className="seg">
          {([["todo", `To review ${counts.todo}`], ["approved", `Approved ${counts.approved}`], ["all", "All"]] as const).map(([k, l]) => (
            <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </nav>
      </div>

      <section className="panel coll-list" style={{ padding: 0 }}>
        {!rows.length && <p className="muted" style={{ padding: 16, margin: 0 }}>{filter === "todo" ? "Nothing to review — every set name is approved." : "No sets."}</p>}
        {rows.map((r) => (
          <div key={r.name} className="aset">
            <div className="aset-row" onClick={() => setOpen(open === r.name ? null : r.name)} role="button" tabIndex={0}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="t">{r.name}</div>
                <div className="small muted">
                  {people(r)}{r.tracked ? ` · ${r.tracked} tracking` : ""}
                  {r.catalog && ` · ${r.catalog.checklistCount ? `checklist ${r.catalog.checklistCount} cards` : "no checklist yet"}`}
                  {r.status === "rename" && <> · same set as <b>{r.approvedName}</b></>}
                </div>
              </div>
              <span className={`badge ${r.status === "approved" ? "high" : r.status === "rename" ? "medium" : "low"}`}>{r.status === "approved" ? "Approved" : r.status === "rename" ? "Use approved name" : "Pending"}</span>
            </div>
            {open === r.name && (
              <div className="aset-body stack">
                {r.status === "rename" && (
                  <div className="row">
                    <span className="small" style={{ flex: 1 }}>Move these {r.cards} cards to the approved name <b>{r.approvedName}</b>.</span>
                    <button className="btn primary small" disabled={!!busy} onClick={() => act(`mv-${r.name}`, { action: "merge", names: [r.name], target: r.approvedName }, (x) => `${x.cards} cards moved to “${x.name}”.`)}>Use approved name</button>
                  </div>
                )}
                {r.status === "pending" && <Pending r={r} approvedNames={approvedNames} busy={!!busy}
                  onApprove={(name, det) => act(`a-${r.name}`, name === r.name ? { action: "approve", name, ...det } : { action: "merge", names: [r.name], target: name }, () => `“${name}” is now approved.`)}
                  onMerge={(target) => act(`m-${r.name}`, { action: "merge", names: [r.name], target }, (x) => `Merged into “${x.name}” — ${x.cards} cards moved.`)} />}
                {r.status === "approved" && r.catalog && <Approved c={r.catalog} busy={busy} act={act} />}
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function DupGroup({ g, rowOf, busy, onMerge, onNotDup }: { g: { names: string[]; suggested: string }; rowOf: (n: string) => Row | undefined; busy: boolean; onMerge: (t: string) => void; onNotDup: () => void }) {
  const [target, setTarget] = useState(g.suggested);
  const total = g.names.reduce((n, x) => n + (rowOf(x)?.cards ?? 0), 0);
  return (
    <div className="panel stack" style={{ gap: 8 }}>
      <span className="small muted">Pick the approved name (or type a better one):</span>
      {g.names.map((n) => {
        const r = rowOf(n);
        return (
          <label key={n} className="switch-row">
            <input type="radio" checked={target === n} onChange={() => setTarget(n)} />
            <span style={{ flex: 1 }}>{n} <span className="muted small">· {r ? people(r) : ""}{r?.status === "approved" ? " · approved" : ""}</span></span>
          </label>
        );
      })}
      <input value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Approved name" />
      <div className="row">
        <button className="btn ghost small" onClick={onNotDup} disabled={busy}>Not duplicates</button>
        <span className="spacer" />
        <button className="btn primary small" disabled={busy || !target.trim()} onClick={() => window.confirm(`Merge into “${target.trim()}”? ${total} cards across everyone's collections will be filed under that name.`) && onMerge(target.trim())}>Merge</button>
      </div>
    </div>
  );
}

function Pending({ r, approvedNames, busy, onApprove, onMerge }: { r: Row; approvedNames: string[]; busy: boolean; onApprove: (name: string, d: Record<string, string>) => void; onMerge: (t: string) => void }) {
  const [name, setName] = useState(r.name);
  const [into, setInto] = useState("");
  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <span className="small muted">Approve as a set (fix the name first if needed — everyone&apos;s cards follow):</span>
        <div className="row">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, width: "auto" }} aria-label="Approved name" />
          <button className="btn primary small" disabled={busy || !name.trim()} onClick={() => onApprove(name.trim(), {})}>Approve</button>
        </div>
      </div>
      {approvedNames.length > 0 && (
        <div className="row">
          <select value={into} onChange={(e) => setInto(e.target.value)} style={{ flex: 1, width: "auto" }} aria-label="Merge into">
            <option value="">…or merge into an approved set</option>
            {approvedNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button className="btn small" disabled={busy || !into} onClick={() => window.confirm(`Move these ${r.cards} cards to “${into}”?`) && onMerge(into)}>Merge</button>
        </div>
      )}
    </>
  );
}

function Approved({ c, busy, act }: { c: Cat; busy: string; act: (k: string, b: Record<string, unknown>, ok: (r: Record<string, unknown>) => string) => Promise<boolean> }) {
  const [name, setName] = useState(c.name);
  const [det, setDet] = useState({ category: c.category ?? "", year: c.year ?? "", manufacturer: c.manufacturer ?? "" });
  const [link, setLink] = useState("");
  const [text, setText] = useState<string | null>(null);
  const synced = (r: Record<string, unknown>) => `Checklist saved (${r.cards} cards)${r.profilesUpdated ? ` — updated for ${r.profilesUpdated} tracking profile${r.profilesUpdated === 1 ? "" : "s"}` : ""}.`;

  async function editList() {
    const r = await api<{ set: { checklist: { number: string | null; name: string; subset: string | null }[] } }>(`/api/admin/sets?id=${c.id}`);
    let sub: string | null = null;
    setText(r.set.checklist.map((e) => { const head = e.subset && e.subset !== sub ? `${(sub = e.subset)}\n` : ""; return `${head}${e.number ?? ""} ${e.name}`.trim(); }).join("\n"));
  }

  return (
    <>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, width: "auto" }} aria-label="Set name" />
        <button className="btn small" disabled={!!busy || name.trim() === c.name || !name.trim()} onClick={() => act(`r-${c.id}`, { action: "rename", id: c.id, name: name.trim() }, (r) => `Renamed — ${r.cards} cards updated.`)}>Rename</button>
      </div>
      {c.aliases.length > 0 && <p className="small muted" style={{ margin: 0 }}>Also matches: {c.aliases.join(", ")}</p>}
      <div className="grid-3">
        <select value={det.category} onChange={(e) => setDet({ ...det, category: e.target.value })} aria-label="Category">
          <option value="">Category…</option>
          {CATEGORIES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <input value={det.year} onChange={(e) => setDet({ ...det, year: e.target.value })} placeholder="Year, e.g. 1993-94" />
        <input value={det.manufacturer} onChange={(e) => setDet({ ...det, manufacturer: e.target.value })} placeholder="Maker, e.g. SkyBox" />
      </div>
      <div className="row"><span className="spacer" /><button className="btn small" disabled={!!busy} onClick={() => act(`d-${c.id}`, { action: "details", id: c.id, ...det }, () => "Details saved.")}>Save details</button></div>

      <div className="aset-check stack">
        <b className="small">Checklist</b>
        <span className="small muted">
          {c.checklistCount ? `${c.checklistCount} cards · ${SOURCE[c.checklist_source ?? ""] ?? "saved"}${c.checklist_updated_at ? ` · ${new Date(c.checklist_updated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}` : ""}` : "No approved checklist yet."}
          {" "}Saving a checklist updates it straight away for everyone tracking this set.
        </span>
        <div className="row">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Checklist page link (https://…)" inputMode="url" style={{ flex: 1, width: "auto" }} />
          <button className="btn small" disabled={!!busy || !/^https?:\/\//.test(link.trim())} onClick={async () => { if (await act(`l-${c.id}`, { action: "checklist", id: c.id, mode: "link", url: link.trim() }, synced)) setLink(""); }}>
            {busy === `l-${c.id}` ? <span className="spinner" /> : "Use link"}
          </button>
        </div>
        <div className="row">
          <button className="btn small" disabled={!!busy} onClick={() => act(`f-${c.id}`, { action: "checklist", id: c.id, mode: "find" }, (r) => synced(r) + (r.incomplete ? " It may be incomplete — check it." : ""))}>
            {busy === `f-${c.id}` ? <><span className="spinner" /> Searching the web…</> : "Web search (last resort)"}
          </button>
          <button className="btn small" disabled={!!busy} onClick={() => (text == null ? editList() : setText(null))}>{text == null ? (c.checklistCount ? "Edit list" : "Type or paste a list") : "Close list"}</button>
        </div>
        {text != null && (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={"One card per line, e.g.\n192 Craig Ehlo\n193 Duane Ferrell\nThunder and Lightning\nTL1 …"} />
            <span className="small muted">One card per line (“number name”). A line with no number starts a subset, e.g. an insert set.</span>
            <div className="row"><span className="spacer" />
              <button className="btn primary small" disabled={!!busy || !text.trim()} onClick={async () => { if (await act(`t-${c.id}`, { action: "checklist", id: c.id, mode: "text", text }, synced)) setText(null); }}>Save checklist</button>
            </div>
          </>
        )}
      </div>
      <div className="row"><span className="spacer" />
        <button className="btn ghost small danger" disabled={!!busy} onClick={() => window.confirm(`Remove “${c.name}” from the approved list? Cards keep their collection name; it will show as pending again.`) && act(`u-${c.id}`, { action: "unapprove", id: c.id }, () => "Removed from the approved list.")}>Remove from approved list</button>
      </div>
    </>
  );
}

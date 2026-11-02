"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, aud } from "@/lib/client";
import type { SetRow } from "@/lib/checklist";

export type Entry = {
  id: string;
  number: string | null;
  name: string;
  subset: string | null;
  image: string | null; // official picture (Pokémon)
  est: number | null;   // rough value from the set price lookup
  card: { id: string; image: string | null; value: number; quantity: number } | null;
};

type View = "grid" | "list" | "binder";
type Filter = "all" | "owned" | "missing";

const PER_PAGE = 9;

export default function SetView({ set, entries }: { set: SetRow; entries: Entry[] }) {
  const router = useRouter();
  const [view, setView] = useState<View>("grid");
  const [filter, setFilter] = useState<Filter>("all");
  const [tickMode, setTickMode] = useState(false);
  // Optimistic ticks: entryId → owned? (cleared when fresh data arrives)
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [paste, setPaste] = useState("");
  const [showOptions, setShowOptions] = useState(false);
  const [autoPics, setAutoPics] = useState(true);
  const [picStatus, setPicStatus] = useState("");
  const picQueue = useRef<Set<string>>(new Set());
  const picRunning = useRef(false);

  useEffect(() => {
    try { const v = localStorage.getItem("cv_set_view") as View | null; if (v === "grid" || v === "list" || v === "binder") setView(v); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    try { if (localStorage.getItem(`cv_autopics_${set.id}`) === "off") setAutoPics(false); } catch { /* ignore */ }
  }, [set.id]);
  const chooseAutoPics = (on: boolean) => { setAutoPics(on); try { localStorage.setItem(`cv_autopics_${set.id}`, on ? "on" : "off"); } catch { /* ignore */ } };
  useEffect(() => { setPending(new Map()); }, [entries]);

  /** Fetch pictures for ticked cards in small batches, in the background. */
  const runPictures = useCallback(async (ids: string[]) => {
    ids.forEach((id) => picQueue.current.add(id));
    if (picRunning.current) return;
    picRunning.current = true;
    let found = 0;
    try {
      while (picQueue.current.size) {
        const batch = [...picQueue.current].slice(0, 4);
        setPicStatus(`Finding pictures… ${picQueue.current.size} to go`);
        const r = await api<{ done: number; capped: boolean }>(`/api/sets/${set.id}/pictures`, { method: "POST", body: JSON.stringify({ ids: batch }) });
        found += r.done;
        batch.forEach((id) => picQueue.current.delete(id));
        router.refresh();
        if (r.capped) {
          picQueue.current.clear();
          setError("This month's free searches are used up, so the remaining pictures will have to wait for the reset.");
          break;
        }
      }
      if (found) setToast(`Added ${found} picture${found === 1 ? "" : "s"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't find pictures");
      picQueue.current.clear();
    } finally {
      picRunning.current = false;
      setPicStatus("");
    }
  }, [router, set.id]);

  const chooseView = (v: View) => { setView(v); try { localStorage.setItem("cv_set_view", v); } catch { /* ignore */ } };

  const isOwned = useCallback((e: Entry) => (pending.has(e.id) ? pending.get(e.id)! : !!e.card), [pending]);

  const stats = useMemo(() => {
    let owned = 0, value = 0, toGo = 0;
    for (const e of entries) {
      if (isOwned(e)) { owned++; value += e.card ? e.card.value : e.est ?? 0; }
      else toGo += e.est ?? 0;
    }
    return { owned, value, toGo, total: entries.length };
  }, [entries, isOwned]);

  const noPicture = entries.filter((e) => e.card && !e.card.image && !e.image).map((e) => e.id);
  const shown = entries.filter((e) => (filter === "owned" ? isOwned(e) : filter === "missing" ? !isOwned(e) : true));

  // ---- saving ticks (batched, so fast taps and drags become one request)
  const queue = useRef<Map<string, boolean>>(new Map());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const changes = queue.current;
    queue.current = new Map();
    const byState = { on: [] as string[], off: [] as string[] };
    for (const [id, own] of changes) {
      const e = entries.find((x) => x.id === id);
      if (!e || own === !!e.card) continue; // no real change
      (own ? byState.on : byState.off).push(id);
    }
    try {
      if (byState.on.length) {
        await api(`/api/sets/${set.id}/toggle`, { method: "POST", body: JSON.stringify({ ids: byState.on, owned: true }) });
        setToast(`+${byState.on.length} ticked`);
        if (autoPics) {
          const needPics = byState.on.filter((id) => !entries.find((x) => x.id === id)?.image); // Pokémon already have one
          if (needPics.length) runPictures(needPics);
        }
      }
      if (byState.off.length) {
        const res = await fetch(`/api/sets/${set.id}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: byState.off, owned: false }) });
        if (res.status === 409) {
          const d = (await res.json()) as { needsConfirm: string[] };
          const ok = window.confirm(`${d.needsConfirm.join(", ")} ${d.needsConfirm.length === 1 ? "was" : "were"} scanned with your photo.\n\nRemove from your collection anyway?`);
          if (ok) await api(`/api/sets/${set.id}/toggle`, { method: "POST", body: JSON.stringify({ ids: byState.off, owned: false, force: true }) });
          else setPending((p) => { const n = new Map(p); byState.off.forEach((id) => n.delete(id)); return n; });
        } else if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Update failed");
        setToast(`Removed ${byState.off.length}`);
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save that change");
      setPending(new Map());
    }
  }, [entries, router, set.id, autoPics, runPictures]);

  const change = useCallback((id: string, own: boolean) => {
    setPending((p) => new Map(p).set(id, own));
    queue.current.set(id, own);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 450);
  }, [flush]);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(""), 2200); return () => clearTimeout(t); }, [toast]);

  /** Normal tap: missing → tick it; owned → open the card. Tick mode: toggle either way. */
  function tap(e: Entry) {
    if (tickMode) return change(e.id, !isOwned(e));
    if (!isOwned(e)) return change(e.id, true);
    if (e.card) router.push(`/card/${e.card.id}`);
  }

  // ---- drag to tick (tick mode only)
  const drag = useRef<{ to: boolean; seen: Set<string> } | null>(null);
  function onPointerDown(ev: React.PointerEvent, e: Entry) {
    if (!tickMode) return;
    ev.preventDefault();
    drag.current = { to: !isOwned(e), seen: new Set([e.id]) };
    change(e.id, drag.current.to);
    (ev.currentTarget.closest("[data-grid]") as HTMLElement | null)?.setPointerCapture(ev.pointerId);
  }
  function onPointerMove(ev: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest("[data-eid]") as HTMLElement | null;
    const id = el?.dataset.eid;
    if (id && !d.seen.has(id)) { d.seen.add(id); change(id, d.to); }
  }
  const endDrag = () => { drag.current = null; };

  async function action(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key); setError("");
    try { await fn(); if (ok) setToast(ok); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    finally { setBusy(""); }
  }

  const pct = stats.total ? Math.round((stats.owned / stats.total) * 100) : 0;

  // ---- tile
  const Tile = ({ e, caption = true }: { e: Entry; caption?: boolean }) => {
    const own = isOwned(e);
    const pic = e.card?.image ?? (own ? e.image : null);
    return (
      <div className="ck-cell">
        <button
          type="button"
          data-eid={e.id}
          className={`ck-tile ${own ? "own" : "miss"}`}
          onClick={() => !tickMode && tap(e)}
          onPointerDown={(ev) => onPointerDown(ev, e)}
          aria-pressed={own}
          aria-label={`${e.number ? `#${e.number} ` : ""}${e.name}${own ? ", owned" : ", missing"}`}
        >
          {own && pic ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={pic} alt="" loading="lazy" draggable={false} />
          ) : own ? (
            <span className="ck-plain">{e.name}</span>
          ) : e.image ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={e.image} alt="" loading="lazy" draggable={false} className="ghost" />
          ) : (
            <span className="ck-sil" />
          )}
          {own && <span className="ck-mark" aria-hidden>✓</span>}
          {(e.card?.quantity ?? 0) > 1 && <span className="ck-qty">×{e.card!.quantity}</span>}
          {e.number && <span className="ck-no">{e.number}</span>}
        </button>
        {caption && <div className={`ck-cap ${own ? "o" : ""}`}>{e.name}</div>}
      </div>
    );
  };

  // ---- empty: no checklist yet
  if (!entries.length) {
    return (
      <div className="stack">
        <h1>{set.name}</h1>
        {error && <p className="error">{error}</p>}
        <section className="panel stack">
          <b>No checklist yet</b>
          <p className="small muted" style={{ margin: 0 }}>Search online for this set&apos;s checklist, or paste one yourself (one card per line, like “1 Captain America”).</p>
          <button className="btn primary" onClick={() => action("build", async () => {
            await api(`/api/sets/${set.id}/build`, { method: "POST", body: "{}" });
            await api(`/api/sets/${set.id}/price`, { method: "POST" }).catch(() => null);
          }, "Checklist found")} disabled={!!busy}>
            {busy === "build" ? <><span className="spinner" /> Finding the checklist…</> : "Find the checklist online"}
          </button>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={"1 Captain America\n2 Captain Britain\n3 Captain Marvel"} />
          <button className="btn" disabled={!!busy || !paste.trim()} onClick={() => action("paste", async () => {
            await api(`/api/sets/${set.id}/build`, { method: "POST", body: JSON.stringify({ pasted: paste }) });
            await api(`/api/sets/${set.id}/price`, { method: "POST" }).catch(() => null);
            setPaste("");
          }, "Checklist saved")}>
            {busy === "paste" ? <span className="spinner" /> : "Use pasted checklist"}
          </button>
        </section>
      </div>
    );
  }

  // ---- list grouped by subset
  const groups: { name: string; items: Entry[] }[] = [];
  for (const e of shown) {
    const g = e.subset || "";
    if (!groups.length || groups[groups.length - 1].name !== g) groups.push({ name: g, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const pages: Entry[][] = [];
  for (let i = 0; i < shown.length; i += PER_PAGE) pages.push(shown.slice(i, i + PER_PAGE));

  return (
    <div className="stack set-view">
      <div>
        <h1>{set.name}</h1>
        <div className="set-ins">
          <div className="ring big" style={{ ["--p" as string]: pct }} role="img" aria-label={`${stats.owned} of ${stats.total}`}>
            <div><span><b>{pct}%</b><small>{stats.owned} / {stats.total}</small></span></div>
          </div>
          <div>
            <div className="set-value">{aud(stats.value, false)}</div>
            <div className="small muted">value of your {stats.owned} card{stats.owned === 1 ? "" : "s"}</div>
            <div className="small muted" style={{ marginTop: 3 }}>
              {stats.total - stats.owned ? `${stats.total - stats.owned} to go${stats.toGo ? ` · ~${aud(stats.toGo, false)} to complete` : ""}` : "Set complete!"}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="error">{error}</p>}

      <div className="set-controls">
        <div className="chips" style={{ margin: 0 }}>
          {(["all", "owned", "missing"] as Filter[]).map((f) => (
            <button key={f} className={`chip ${filter === f ? "on" : ""}`} onClick={() => setFilter(f)}>
              {f === "all" ? `All ${stats.total}` : f === "owned" ? `Owned ${stats.owned}` : `Missing ${stats.total - stats.owned}`}
            </button>
          ))}
        </div>
        <div className="seg" role="tablist" aria-label="Layout">
          {(["grid", "list", "binder"] as View[]).map((v) => (
            <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => chooseView(v)}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {view !== "list" && (
        <div className={`tick-bar ${tickMode ? "on" : ""}`}>
          {tickMode ? (
            <>
              <span className="small"><b>Tick-off mode:</b> tap cards you have, or drag across several.</span>
              <button className="btn primary small" onClick={() => setTickMode(false)}>Done</button>
            </>
          ) : (
            <>
              <span className="small muted">Tap a missing card to tick it · tap an owned card for details</span>
              <button className="btn small" onClick={() => setTickMode(true)}>Tick off cards</button>
            </>
          )}
        </div>
      )}

      <div className="pic-bar">
        <label className="switch">
          <input type="checkbox" checked={autoPics} onChange={(e) => chooseAutoPics(e.target.checked)} />
          <span className="track" aria-hidden />
          <span className="small">Find pictures when I tick <span className="muted">(1 search each)</span></span>
        </label>
        {picStatus ? (
          <span className="small" style={{ color: "var(--cyan)" }}><span className="spinner" style={{ width: 12, height: 12, display: "inline-block", verticalAlign: -1, marginRight: 6 }} />{picStatus}</span>
        ) : noPicture.length > 0 ? (
          <button className="btn small" onClick={() => runPictures(noPicture)}>
            Find pictures for {noPicture.length} card{noPicture.length === 1 ? "" : "s"}
          </button>
        ) : null}
      </div>

      {!shown.length && <p className="muted">Nothing here with this filter.</p>}

      {view === "grid" && (
        <div className={`ck-grid ${tickMode ? "ticking" : ""}`} data-grid onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
          {shown.map((e) => <Tile key={e.id} e={e} />)}
        </div>
      )}

      {view === "binder" && (
        <div className="binder" aria-label="Binder pages">
          {pages.map((pg, i) => (
            <section key={i} className="binder-page">
              <div className={`ck-grid three ${tickMode ? "ticking" : ""}`} data-grid onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
                {pg.map((e) => <div key={e.id} className="pocket"><Tile e={e} caption={false} /></div>)}
              </div>
              <div className="small muted binder-foot">Page {i + 1} of {pages.length}{pg[0]?.number ? ` · #${pg[0].number}–${pg[pg.length - 1].number}` : ""}</div>
            </section>
          ))}
        </div>
      )}

      {view === "list" && (
        <div className="ck-list">
          {groups.map((g, gi) => (
            <section key={gi}>
              {g.name && <div className="ck-sub">{g.name}</div>}
              {g.items.map((e) => {
                const own = isOwned(e);
                return (
                  <div key={e.id} className="ck-row">
                    <button className={`ck-box ${own ? "on" : ""}`} onClick={() => change(e.id, !own)} aria-pressed={own} aria-label={`${own ? "Untick" : "Tick"} ${e.name}`}>
                      {own ? "✓" : ""}
                    </button>
                    <span className="ck-num">{e.number ? `#${e.number}` : ""}</span>
                    {own && e.card ? (
                      <Link href={`/card/${e.card.id}`} className="ck-name"><b>{e.name}</b>{e.card.quantity > 1 && <span className="ck-qty inline">×{e.card.quantity}</span>}</Link>
                    ) : (
                      <span className="ck-name"><b>{e.name}</b></span>
                    )}
                    <span className={`ck-val ${own ? "" : "m"}`}>
                      {own ? aud(e.card ? e.card.value : e.est) : e.est != null ? `~${aud(e.est)}` : ""}
                    </span>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}

      <section className="panel stack" style={{ marginTop: 8 }}>
        <button className="row btn ghost" style={{ justifyContent: "space-between", width: "100%" }} onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions}>
          <span>Set options</span><span>{showOptions ? "−" : "+"}</span>
        </button>
        {showOptions && (
          <div className="stack">
            <p className="small muted" style={{ margin: 0 }}>
              {set.source === "pokemon" ? "Checklist and prices from the official Pokémon card database." : set.source === "manual" ? "Checklist pasted by you." : set.source_url ? <>Checklist found at <a href={set.source_url} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>{new URL(set.source_url).hostname}</a> — check it looks right.</> : "Checklist found online."}
              {set.priced_at && ` Values estimated ${new Date(set.priced_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}.`}
            </p>
            <div className="row">
              <button className="btn small" disabled={!!busy} onClick={() => action("price", () => api(`/api/sets/${set.id}/price`, { method: "POST" }), "Set values updated")}>
                {busy === "price" ? <span className="spinner" /> : "Re-check set values"}
              </button>
              <button className="btn small" disabled={!!busy} onClick={() => { if (confirm("Search for this set's checklist again? Your ticked cards stay ticked.")) action("build", () => api(`/api/sets/${set.id}/build`, { method: "POST", body: "{}" }), "Checklist refreshed"); }}>
                {busy === "build" ? <span className="spinner" /> : "Find checklist again"}
              </button>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Re-checking set values only fills in estimates — cards that already have a value keep it. To re-value one card, open it and tap “Update value”.</p>
            <label className="field">
              <span>Replace with a pasted checklist</span>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder={"1 Captain America\n2 Captain Britain"} />
            </label>
            <div className="row">
              <button className="btn small" disabled={!!busy || !paste.trim()} onClick={() => action("paste", async () => { await api(`/api/sets/${set.id}/build`, { method: "POST", body: JSON.stringify({ pasted: paste }) }); setPaste(""); }, "Checklist replaced")}>
                {busy === "paste" ? <span className="spinner" /> : "Use pasted checklist"}
              </button>
              <span className="spacer" />
              <button className="btn ghost small danger" disabled={!!busy} onClick={() => { if (confirm("Stop tracking this set? Your cards stay in your collection.")) action("stop", async () => { await api(`/api/sets/${set.id}`, { method: "DELETE" }); router.push("/sets"); }); }}>
                Stop tracking
              </button>
            </div>
          </div>
        )}
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

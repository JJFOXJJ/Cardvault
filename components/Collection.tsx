"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Card } from "@/lib/supabase";
import { api, aud } from "@/lib/client";
import { similarGroups } from "@/lib/collections";
import { stackKey } from "@/lib/stack";

const UNSORTED = "Unsorted";

type Group = "set" | "category" | "manufacturer" | "year" | "none";
type Sort = "number" | "value" | "recent" | "name";
type Size = "s" | "m" | "l";
/** One tile: a card, or several saved copies of the same card shown together. */
type Stack = { key: string; top: Card; copies: Card[]; qty: number; value: number };

const ALL = "__all";

const GROUP_FIELD: Record<Exclude<Group, "none">, (c: Card) => string | null> = {
  set: (c) => c.set_name,
  category: (c) => c.category,
  manufacturer: (c) => c.manufacturer,
  year: (c) => c.year,
};
const GROUP_EMPTY: Record<Exclude<Group, "none">, string> = { set: "Unsorted", category: "Other", manufacturer: "Unknown maker", year: "Unknown year" };

export default function Collection({ cards }: { cards: Card[] }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [coll, setColl] = useState(ALL);
  const [dupesOnly, setDupesOnly] = useState(false);
  const [size, setSizeState] = useState<Size>("m");
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [merging, setMerging] = useState("");
  const [group, setGroupState] = useState<Group>("set");
  const [sort, setSortState] = useState<Sort>("number");
  const [busy, setBusy] = useState("");
  const [dismissed, setDismissed] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    try {
      setDismissed(JSON.parse(localStorage.getItem("cv_merge_dismissed") || "[]"));
      const v = JSON.parse(localStorage.getItem("cv_view") || "{}");
      if (v.group) setGroupState(v.group);
      if (v.sort) setSortState(v.sort);
      if (v.size) setSizeState(v.size);
      setCollapsed(JSON.parse(localStorage.getItem("cv_collapsed") || "[]"));
    } catch { /* ignore */ }
  }, []);

  // Remember the chosen view on this device.
  const saveView = (g: Group, s: Sort, z: Size) => { try { localStorage.setItem("cv_view", JSON.stringify({ group: g, sort: s, size: z })); } catch { /* ignore */ } };
  const setGroup = (g: Group) => { setGroupState(g); saveView(g, sort, size); };
  const setSort = (s: Sort) => { setSortState(s); saveView(group, s, size); };
  const setSize = (z: Size) => { setSizeState(z); saveView(group, sort, z); };
  const saveCollapsed = (next: string[]) => { setCollapsed(next); try { localStorage.setItem("cv_collapsed", JSON.stringify(next)); } catch { /* ignore */ } };
  const ck = (name: string) => `${group}:${name}`;
  const toggleGroup = (name: string) => saveCollapsed(collapsed.includes(ck(name)) ? collapsed.filter((x) => x !== ck(name)) : [...collapsed, ck(name)]);

  // Collection names with card counts, for merge suggestions.
  const setCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) if (c.set_name?.trim()) m.set(c.set_name.trim(), (m.get(c.set_name.trim()) ?? 0) + c.quantity);
    return m;
  }, [cards]);

  const suggestions = useMemo(
    () =>
      similarGroups([...setCounts.keys()])
        .map((g) => g.sort((a, b) => (setCounts.get(b) ?? 0) - (setCounts.get(a) ?? 0)))
        .filter((g) => !dismissed.includes(g.join("|"))),
    [setCounts, dismissed],
  );

  async function renameCollection(from: string, to: string) {
    const target = to.trim();
    if (!target || target === from) return;
    setBusy(from);
    try {
      await api("/api/collections", { method: "PATCH", body: JSON.stringify({ from: from === UNSORTED ? null : from, to: target }) });
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setBusy("");
    }
  }

  function askRename(from: string) {
    const to = window.prompt(
      `Rename "${from}" to…\n\nTip: type the name of another collection to merge them.`,
      from === UNSORTED ? "" : from,
    );
    if (to != null) renameCollection(from, to);
  }


  function dismiss(group: string[]) {
    const next = [...dismissed, group.join("|")];
    setDismissed(next);
    try { localStorage.setItem("cv_merge_dismissed", JSON.stringify(next)); } catch { /* ignore */ }
  }

  const categories = useMemo(() => ["All", ...Array.from(new Set(cards.map((c) => c.category))).sort()], [cards]);
  const collectionNames = useMemo(
    () => [...setCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).concat(cards.some((c) => !c.set_name?.trim()) ? [[UNSORTED, 0]] : []),
    [setCounts, cards],
  );

  // Copies of the same card saved separately, keyed by stack.
  const stackOf = useMemo(() => {
    const m = new Map<string, Card[]>();
    for (const c of cards) { const k = stackKey(c) ?? `id:${c.id}`; m.set(k, [...(m.get(k) ?? []), c]); }
    return m;
  }, [cards]);
  const keyOf = (c: Card) => stackKey(c) ?? `id:${c.id}`;
  const splitStacks = useMemo(() => [...stackOf.values()].filter((cs) => cs.length > 1), [stackOf]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (cat !== "All" && c.category !== cat) return false;
      if (coll !== ALL && (c.set_name?.trim() || UNSORTED) !== coll) return false;
      if (dupesOnly && (stackOf.get(keyOf(c)) ?? [c]).reduce((n, x) => n + x.quantity, 0) < 2) return false;
      if (!needle) return true;
      return [c.name, c.subject, c.set_name, c.manufacturer, c.year, c.card_number, c.variant, c.notes]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, q, cat, coll, dupesOnly, stackOf]);

  const totals = useMemo(() => {
    const count = filtered.reduce((n, c) => n + c.quantity, 0);
    const value = filtered.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0);
    const sets = new Set(filtered.map((c) => c.set_name?.trim() || UNSORTED)).size;
    return { count, value, sets };
  }, [filtered]);

  const groups = useMemo(() => {
    // Stack identical cards into one tile first.
    const byKey = new Map<string, Card[]>();
    for (const c of filtered) { const k = keyOf(c); byKey.set(k, [...(byKey.get(k) ?? []), c]); }
    const stacks: Stack[] = [...byKey.entries()].map(([key, copies]) => {
      const top = [...copies].sort((a, b) => Number(!!b.image_url) - Number(!!a.image_url) || a.created_at.localeCompare(b.created_at))[0];
      return { key, top, copies, qty: copies.reduce((n, c) => n + c.quantity, 0), value: copies.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0) };
    });
    const newest = (st: Stack) => st.copies.reduce((m, c) => (c.created_at > m ? c.created_at : m), "");
    if (sort === "value") stacks.sort((a, b) => (b.top.aud_mid ?? 0) - (a.top.aud_mid ?? 0));
    else if (sort === "name") stacks.sort((a, b) => a.top.name.localeCompare(b.top.name));
    else if (sort === "recent") stacks.sort((a, b) => newest(b).localeCompare(newest(a)));
    else stacks.sort((a, b) => (a.top.card_number ?? "").localeCompare(b.top.card_number ?? "", undefined, { numeric: true }));

    const sum = (list: Stack[]) => ({ value: list.reduce((n, st) => n + st.value, 0), count: list.reduce((n, st) => n + st.qty, 0) });
    if (group === "none") return [{ name: "", stacks, ...sum(stacks) }];
    const field = GROUP_FIELD[group];
    const map = new Map<string, Stack[]>();
    for (const st of stacks) {
      const key = field(st.top)?.trim() || GROUP_EMPTY[group];
      map.set(key, [...(map.get(key) ?? []), st]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, stacks: list, ...sum(list) }))
      .sort((a, b) => (group === "year" ? b.name.localeCompare(a.name) : b.value - a.value));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, group]);

  async function merge(stacks: Card[][]) {
    const copies = stacks.reduce((n, s) => n + s.length, 0);
    if (!window.confirm(stacks.length === 1
      ? `Merge the ${copies} saved copies of “${stacks[0][0].name}” into one card with quantity ${stacks[0].reduce((n, c) => n + c.quantity, 0)}?`
      : `Merge ${copies} separately saved copies into ${stacks.length} cards (quantities are added up)?`)) return;
    try {
      for (const [i, st] of stacks.entries()) {
        setMerging(stacks.length > 1 ? `Merging ${i + 1} of ${stacks.length}…` : "Merging…");
        await api("/api/cards/merge", { method: "POST", body: JSON.stringify({ ids: st.map((c) => c.id) }) });
      }
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Merge failed");
    } finally {
      setMerging("");
    }
  }

  const filtersOn = cat !== "All" || coll !== ALL || dupesOnly || !!q.trim();
  const visibleNames = groups.map((g) => g.name).filter(Boolean);
  const allCollapsed = visibleNames.length > 0 && visibleNames.every((n) => collapsed.includes(ck(n)));

  if (!cards.length) {
    return (
      <div className="empty">
        <div className="brand-mark" />
        <h1>Your vault is empty</h1>
        <p className="muted">Photograph a card and it&apos;ll be identified, valued and filed into its set.</p>
        <Link href="/add" className="btn primary" style={{ marginTop: 10 }}>Scan your first card</Link>
      </div>
    );
  }

  return (
    <>
      <section className="worth" aria-label="Collection value">
        <div className="v">{aud(totals.value, false)}</div>
        <p>
          Estimated value of <b>{totals.count} card{totals.count === 1 ? "" : "s"}</b> across{" "}
          <b>{totals.sets} collection{totals.sets === 1 ? "" : "s"}</b>{filtersOn ? " shown" : ""}.
        </p>
      </section>

      {suggestions.length > 0 && (
        <div className="merge-hint row">
          <span style={{ flex: "1 1 220px" }}>
            <b>{suggestions.length} possible duplicate collection{suggestions.length === 1 ? "" : "s"}</b>
            <span className="muted small"> — e.g. {suggestions[0].map((n) => `“${n}”`).join(" and ")}</span>
          </span>
          <Link href="/collections" className="btn primary small">Review</Link>
          <button className="btn ghost small" onClick={() => suggestions.forEach(dismiss)}>Dismiss</button>
        </div>
      )}

      {splitStacks.length > 0 && (
        <div className="merge-hint row">
          <span style={{ flex: "1 1 220px" }}>
            <b>{splitStacks.length} card{splitStacks.length === 1 ? " is" : "s are"} saved more than once</b>
            <span className="muted small"> — they&apos;re shown stacked (×2 etc.). Merge them into one card each with the right quantity?</span>
          </span>
          <button className="btn primary small" onClick={() => merge(splitStacks)} disabled={!!merging}>{merging || "Merge copies"}</button>
          <button className="btn ghost small" onClick={() => { setDupesOnly(true); setCat("All"); setColl(ALL); }}>Show them</button>
        </div>
      )}

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, player, set, number…" type="search" />
        <select value={group} onChange={(e) => setGroup(e.target.value as Group)} aria-label="Group by">
          <option value="set">By collection</option>
          <option value="category">By category</option>
          <option value="manufacturer">By maker</option>
          <option value="year">By year</option>
          <option value="none">No grouping</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="number">Card number</option>
          <option value="value">Highest value</option>
          <option value="recent">Newest first</option>
          <option value="name">A–Z</option>
        </select>
        <select value={coll} onChange={(e) => setColl(e.target.value)} aria-label="Collection" className={coll !== ALL ? "on" : ""}>
          <option value={ALL}>All collections</option>
          {collectionNames.map(([n]) => <option key={n} value={n}>{n}</option>)}
        </select>
        <Link href="/collections" className="btn small">Collections</Link>
        <a href="/api/export" className="btn small">Export CSV</a>
      </div>

      <div className="chips">
        <button className={`chip dupe ${dupesOnly ? "on" : ""}`} onClick={() => setDupesOnly(!dupesOnly)} aria-pressed={dupesOnly}>
          Duplicates
        </button>
        <span className="chip-sep" aria-hidden />
        {categories.map((c) => (
          <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      <div className="view-bar">
        <div className="seg size-seg" role="group" aria-label="Card size">
          {(["s", "m", "l"] as Size[]).map((z) => (
            <button key={z} className={size === z ? "on" : ""} onClick={() => setSize(z)} aria-pressed={size === z} title={{ s: "Small — fit more cards", m: "Medium", l: "Large" }[z]}>
              {z.toUpperCase()}
            </button>
          ))}
        </div>
        {group !== "none" && visibleNames.length > 1 && (
          <button className="btn ghost small" onClick={() => saveCollapsed(allCollapsed
            ? collapsed.filter((x) => !visibleNames.map(ck).includes(x))
            : [...new Set([...collapsed, ...visibleNames.map(ck)])])}>
            {allCollapsed ? "Expand all" : "Collapse all"}
          </button>
        )}
        <span className="spacer" />
        {filtersOn && (
          <button className="btn ghost small" onClick={() => { setQ(""); setCat("All"); setColl(ALL); setDupesOnly(false); }}>Clear filters</button>
        )}
      </div>

      {!filtered.length && <p className="muted">{dupesOnly ? "No duplicates — every card is a single copy." : "No cards match."}</p>}

      {groups.map((g) => {
        const shut = !!g.name && collapsed.includes(ck(g.name));
        return (
          <section key={g.name || "all"} className={shut ? "group shut" : "group"}>
            {g.name && (
              <div className="set-head">
                <button className="fold" onClick={() => toggleGroup(g.name)} aria-expanded={!shut} title={shut ? "Show these cards" : "Hide these cards"}>
                  <span className="chev" aria-hidden>▾</span>
                  <h2>{g.name}</h2>
                </button>
                <span className="muted small set-count">{g.count} card{g.count === 1 ? "" : "s"}</span>
                {group === "set" && !shut && (
                  <button className="btn ghost small" onClick={() => askRename(g.name)} disabled={!!busy} title="Rename or merge this collection">
                    {busy === g.name ? <span className="spinner" /> : "Rename"}
                  </button>
                )}
                <span className="spacer" />
                <span>{aud(g.value, false)}</span>
              </div>
            )}
            {!shut && (
              <div className={`cards size-${size}`}>
                {g.stacks.map(({ key, top: c, copies, qty }) => (
                  <div key={key} className={`tile-wrap ${copies.length > 1 ? "stacked" : ""}`}>
                    <Link href={`/card/${c.id}`} className="tile">
                      <div className="art">
                        {c.image_url ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img src={c.image_url} alt={c.name} loading="lazy" />
                        ) : (
                          <span className="ck-plain">{c.subject || c.name}{c.card_number ? <small>#{c.card_number}</small> : null}</span>
                        )}
                        {qty > 1 && <span className="qty" title={`You have ${qty}`}>×{qty}</span>}
                        {c.image_url && c.image_url === c.photo_url && <span className="own">your photo</span>}
                      </div>
                      <div>
                        <div className="t">{c.name}</div>
                        <div className="s">{[c.year, c.manufacturer].filter(Boolean).join(" · ") || c.category}</div>
                        <div className="v">{aud(c.aud_mid)}{qty > 1 && c.aud_mid != null && size !== "s" ? <span className="muted each"> each</span> : null}</div>
                      </div>
                    </Link>
                    {copies.length > 1 && size !== "s" && (
                      <button className="stack-merge" onClick={() => merge([copies])} disabled={!!merging} title="These copies were saved separately">
                        {copies.length} saved separately · Merge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

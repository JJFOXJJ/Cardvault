"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { Card } from "@/lib/supabase";
import { api, aud } from "@/lib/client";
import { similarGroups } from "@/lib/collections";

const UNSORTED = "Unsorted";

type Group = "set" | "category" | "manufacturer" | "year" | "none";
type Sort = "number" | "value" | "recent" | "name";

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
    } catch { /* ignore */ }
  }, []);

  // Remember the chosen view on this device.
  const saveView = (g: Group, s: Sort) => { try { localStorage.setItem("cv_view", JSON.stringify({ group: g, sort: s })); } catch { /* ignore */ } };
  const setGroup = (g: Group) => { setGroupState(g); saveView(g, sort); };
  const setSort = (s: Sort) => { setSortState(s); saveView(group, s); };

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (cat !== "All" && c.category !== cat) return false;
      if (!needle) return true;
      return [c.name, c.subject, c.set_name, c.manufacturer, c.year, c.card_number, c.variant, c.notes]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [cards, q, cat]);

  const totals = useMemo(() => {
    const count = filtered.reduce((n, c) => n + c.quantity, 0);
    const value = filtered.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0);
    const sets = new Set(filtered.map((c) => c.set_name?.trim() || UNSORTED)).size;
    return { count, value, sets };
  }, [filtered]);

  const groups = useMemo(() => {
    const list = [...filtered];
    if (sort === "value") list.sort((a, b) => (b.aud_mid ?? 0) - (a.aud_mid ?? 0));
    else if (sort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === "recent") list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else list.sort((a, b) => (a.card_number ?? "").localeCompare(b.card_number ?? "", undefined, { numeric: true }));

    if (group === "none") return [{ name: "", cards: list, value: 0 }];
    const field = GROUP_FIELD[group];
    const map = new Map<string, Card[]>();
    for (const c of list) {
      const key = field(c)?.trim() || GROUP_EMPTY[group];
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()]
      .map(([name, cs]) => ({ name, cards: cs, value: cs.reduce((n, c) => n + (c.aud_mid ?? 0) * c.quantity, 0) }))
      .sort((a, b) => (group === "year" ? b.name.localeCompare(a.name) : b.value - a.value));
  }, [filtered, sort, group]);

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
      <section className="hero">
        <div className="stat gold"><b>{aud(totals.value, false)}</b><span>Estimated value</span></div>
        <div className="stat"><b>{totals.count}</b><span>Cards</span></div>
        <div className="stat"><b>{totals.sets}</b><span>Collections</span></div>
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

      <div className="toolbar">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, player, set, number…" type="search" />
        <select value={group} onChange={(e) => setGroup(e.target.value as Group)} aria-label="Group by">
          <option value="set">Group: Collection</option>
          <option value="category">Group: Category</option>
          <option value="manufacturer">Group: Manufacturer</option>
          <option value="year">Group: Year</option>
          <option value="none">No grouping</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="number">Sort: Card number</option>
          <option value="value">Sort: Highest value</option>
          <option value="recent">Sort: Recently added</option>
          <option value="name">Sort: A–Z</option>
        </select>
        <Link href="/collections" className="btn small">Collections</Link>
        <a href="/api/export" className="btn small">Export CSV</a>
      </div>

      <div className="chips">
        {categories.map((c) => (
          <button key={c} className={`chip ${cat === c ? "on" : ""}`} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>

      {!filtered.length && <p className="muted">No cards match.</p>}

      {groups.map((g) => (
        <section key={g.name || "all"}>
          {g.name && (
            <div className="set-head">
              <h2>{g.name}</h2>
              <span className="muted small">{g.cards.reduce((n, c) => n + c.quantity, 0)} cards</span>
              {group === "set" && (
                <button className="btn ghost small" onClick={() => askRename(g.name)} disabled={!!busy} title="Rename or merge this collection">
                  {busy === g.name ? <span className="spinner" /> : "Rename"}
                </button>
              )}
              <span className="spacer" />
              <span>{aud(g.value, false)}</span>
            </div>
          )}
          <div className="cards">
            {g.cards.map((c) => (
              <Link key={c.id} href={`/card/${c.id}`} className="tile">
                <div className="art">
                  {c.image_url ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={c.image_url} alt={c.name} loading="lazy" />
                  ) : null}
                  {c.quantity > 1 && <span className="qty">×{c.quantity}</span>}
                  {c.image_url && c.image_url === c.photo_url && <span className="own">your photo</span>}
                </div>
                <div>
                  <div className="t">{c.name}</div>
                  <div className="s">{[c.year, c.manufacturer].filter(Boolean).join(" · ") || c.category}</div>
                  <div className="v">{aud(c.aud_mid)}</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

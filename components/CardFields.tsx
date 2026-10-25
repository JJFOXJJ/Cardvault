"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, CONDITIONS, MANUFACTURERS } from "@/lib/client";
import ComboSelect, { type ComboOption } from "./ComboSelect";

export type Fields = {
  category: string;
  name: string;
  subject: string;
  year: string;
  manufacturer: string;
  set_name: string;
  card_number: string;
  variant: string;
  graded: string;
  condition: string;
  quantity: number;
  notes: string;
};

export const emptyFields: Fields = {
  category: "Other", name: "", subject: "", year: "", manufacturer: "", set_name: "",
  card_number: "", variant: "", graded: "", condition: "Near Mint", quantity: 1, notes: "",
};

export function fieldsFrom(src: Partial<Record<keyof Fields, unknown>>): Fields {
  const f = { ...emptyFields };
  for (const k of Object.keys(f) as (keyof Fields)[]) {
    const v = src[k];
    if (v != null) (f as Record<string, unknown>)[k] = k === "quantity" ? Number(v) || 1 : String(v);
  }
  return f;
}

/** Empty strings become null before saving. */
export function toPayload(f: Fields) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(f)) out[k] = typeof v === "string" ? v.trim() || null : v;
  out.name = f.name.trim() || "Unnamed card";
  out.category = f.category.trim() || "Other";
  return out;
}

type Count = { name: string; cards: number };
type Options = { collections: Count[]; manufacturers: Count[]; categories: Count[] };

// Shared across every form on the page; refreshed on each page load.
let optionsPromise: Promise<Options> | null = null;
function loadOptions(): Promise<Options> {
  optionsPromise ??= fetch("/api/collections")
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => ({ collections: d?.collections ?? [], manufacturers: d?.manufacturers ?? [], categories: d?.categories ?? [] }))
    .catch(() => ({ collections: [], manufacturers: [], categories: [] }));
  return optionsPromise;
}

const plural = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

/** Names you've used (with counts) first, then common defaults you haven't used yet. */
function merged(used: Count[], defaults: string[]): ComboOption[] {
  const usedNames = new Set(used.map((u) => u.name.toLowerCase()));
  return [
    ...[...used].sort((a, b) => b.cards - a.cards || a.name.localeCompare(b.name)).map((u) => ({ value: u.name, label: `${u.name} (${plural(u.cards)})` })),
    ...defaults.filter((d) => !usedNames.has(d.toLowerCase())).map((d) => ({ value: d })),
  ];
}

export default function CardFields({
  value,
  onChange,
  originalSet,
}: {
  value: Fields;
  onChange: (f: Fields) => void;
  /** The card's current collection, so its own count isn't confusing on the edit screen. */
  originalSet?: string | null;
}) {
  const set = <K extends keyof Fields>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: k === "quantity" ? Number(e.target.value) : e.target.value });
  const setVal = (k: keyof Fields) => (v: string) => onChange({ ...value, [k]: v });

  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    let live = true;
    loadOptions().then((o) => live && setOpts(o));
    return () => { live = false; };
  }, []);

  const collections: ComboOption[] = (opts?.collections ?? [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ value: c.name, label: `${c.name} (${plural(c.cards)})` }));
  const isNewCollection = !!value.set_name.trim() && !!opts && !collections.some((c) => c.value === value.set_name) && value.set_name !== originalSet;

  return (
    <div className="stack">
      <label className="field"><span>Card title</span><input value={value.name} onChange={set("name")} placeholder="e.g. Michael Jordan #57" /></label>

      <div className="field">
        <span>Collection / set</span>
        {opts ? (
          <ComboSelect
            value={value.set_name}
            onChange={setVal("set_name")}
            options={collections}
            emptyLabel="Unsorted"
            newLabel="New collection…"
            placeholder="e.g. 1992 Marvel Masterpieces"
            newNote={isNewCollection ? "This will start a new collection." : undefined}
          />
        ) : (
          <input value={value.set_name} onChange={set("set_name")} placeholder="Loading collections…" />
        )}
      </div>

      <div className="grid-2">
        <div className="field">
          <span>Category</span>
          <ComboSelect value={value.category} onChange={setVal("category")} options={merged(opts?.categories ?? [], CATEGORIES)} emptyLabel="—" placeholder="Type a category" />
        </div>
        <div className="field">
          <span>Manufacturer</span>
          <ComboSelect value={value.manufacturer} onChange={setVal("manufacturer")} options={merged(opts?.manufacturers ?? [], MANUFACTURERS)} placeholder="Type a manufacturer" />
        </div>
        <label className="field"><span>Player / character</span><input value={value.subject} onChange={set("subject")} /></label>
        <label className="field"><span>Year</span><input value={value.year} onChange={set("year")} inputMode="numeric" /></label>
        <label className="field"><span>Card number</span><input value={value.card_number} onChange={set("card_number")} /></label>
        <label className="field"><span>Variant / parallel</span><input value={value.variant} onChange={set("variant")} placeholder="Holo, Refractor, /99…" /></label>
        <label className="field"><span>Condition</span>
          <select value={value.condition} onChange={set("condition")}>
            <option value="">—</option>
            {CONDITIONS.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="field"><span>Graded</span><input value={value.graded} onChange={set("graded")} placeholder="e.g. PSA 9 (blank if raw)" /></label>
        <label className="field"><span>Quantity</span><input type="number" min={1} value={value.quantity} onChange={set("quantity")} /></label>
      </div>
      <label className="field"><span>Notes</span><textarea value={value.notes} onChange={set("notes")} placeholder="Where you got it, sleeve/binder location…" /></label>
    </div>
  );
}

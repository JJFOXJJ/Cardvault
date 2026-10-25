"use client";

import { CATEGORIES, CONDITIONS } from "@/lib/client";

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
  return out;
}

export default function CardFields({ value, onChange }: { value: Fields; onChange: (f: Fields) => void }) {
  const set = <K extends keyof Fields>(k: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: k === "quantity" ? Number(e.target.value) : e.target.value });

  const categories = CATEGORIES.includes(value.category) ? CATEGORIES : [...CATEGORIES, value.category];

  return (
    <div className="stack">
      <label className="field"><span>Card title</span><input value={value.name} onChange={set("name")} placeholder="e.g. Michael Jordan #57" /></label>
      <div className="grid-2">
        <label className="field"><span>Category</span>
          <select value={value.category} onChange={set("category")}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
        </label>
        <label className="field"><span>Player / character</span><input value={value.subject} onChange={set("subject")} /></label>
      </div>
      <label className="field"><span>Collection / set</span><input value={value.set_name} onChange={set("set_name")} placeholder="e.g. 1992 Marvel Masterpieces" /></label>
      <div className="grid-2">
        <label className="field"><span>Year</span><input value={value.year} onChange={set("year")} /></label>
        <label className="field"><span>Manufacturer</span><input value={value.manufacturer} onChange={set("manufacturer")} /></label>
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

"use client";

import { useState } from "react";

export type ComboOption = { value: string; label?: string };

const NEW = "__new__";

/**
 * A dropdown of known values with a "type your own" option.
 * If the current value isn't in the list, the text box shows it so nothing is lost.
 */
export default function ComboSelect({
  value,
  onChange,
  options,
  newLabel = "Other (type it)…",
  emptyLabel = "—",
  placeholder,
  newNote,
}: {
  value: string;
  onChange: (v: string) => void;
  options: ComboOption[];
  newLabel?: string;
  emptyLabel?: string;
  placeholder?: string;
  newNote?: string;   // shown under the text box, e.g. "This starts a new collection"
}) {
  const inList = options.some((o) => o.value === value);
  const [typing, setTyping] = useState(false);
  const custom = typing || (!!value && !inList);

  return (
    <div className="combo">
      <select
        value={custom ? NEW : value}
        onChange={(e) => {
          if (e.target.value === NEW) {
            setTyping(true);
            if (inList) onChange("");
          } else {
            setTyping(false);
            onChange(e.target.value);
          }
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
        ))}
        <option value={NEW}>{newLabel}</option>
      </select>
      {custom && (
        <>
          <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={typing && !value} />
          {newNote && value.trim() && <span className="small muted">{newNote}</span>}
        </>
      )}
    </div>
  );
}

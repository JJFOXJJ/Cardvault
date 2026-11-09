"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/client";

export type SetChoice = { name: string; checklist: number; approved: boolean; yours: number; category: string | null };
export const GUESS = "__guess__";

let choicesPromise: Promise<SetChoice[]> | null = null;
const loadChoices = () => (choicesPromise ??= api<{ sets: SetChoice[] }>("/api/scan/sets").then((d) => d.sets).catch(() => { choicesPromise = null; return []; }));

/**
 * Choose the set before scanning. Only listed sets (the approved list and your own collections) can be picked,
 * plus a clearly labelled last-resort "let the AI guess" option.
 */
export default function SetPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [sets, setSets] = useState<SetChoice[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { loadChoices().then(setSets); }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (sets ?? []).filter((s) => words.every((w) => s.name.toLowerCase().includes(w))).slice(0, 40);
  }, [sets, q]);
  const current = value && value !== GUESS ? sets?.find((s) => s.name === value) : null;

  return (
    <div className="setpick" ref={box}>
      <span className="setpick-label">Set</span>
      <button type="button" className={`setpick-btn ${value ? "" : "empty"}`} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {value === GUESS ? <span>Not listed — let the AI guess <small>(last resort)</small></span>
          : value ? <span>{value}{current ? <small> · {current.checklist ? `checklist ${current.checklist} cards` : "no checklist yet"}</small> : null}</span>
          : <span>Choose the set this card is from…</span>}
        <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="setpick-menu">
          <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search sets…" />
          {sets == null && <div className="small muted" style={{ padding: 10 }}><span className="spinner" /> Loading sets…</div>}
          {shown.map((s) => (
            <button key={s.name} type="button" className={`setpick-opt ${s.name === value ? "on" : ""}`} onClick={() => { onChange(s.name); setOpen(false); setQ(""); }}>
              <span className="nm">{s.name}{s.approved ? " ✓" : ""}</span>
              <span className="small muted">{[s.checklist ? `${s.checklist} on checklist` : "no checklist", s.yours ? `${s.yours} yours` : null].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
          {sets && !shown.length && <div className="small muted" style={{ padding: 10 }}>No listed set matches. Ask an admin to add it, or use the last resort below.</div>}
          <button type="button" className={`setpick-opt guess ${value === GUESS ? "on" : ""}`} onClick={() => { onChange(GUESS); setOpen(false); }}>
            <span className="nm">Not listed — let the AI guess the set</span>
            <span className="small muted">Last resort: the AI names the set itself (it can be wrong); an admin tidies it up in the Set list.</span>
          </button>
        </div>
      )}
    </div>
  );
}

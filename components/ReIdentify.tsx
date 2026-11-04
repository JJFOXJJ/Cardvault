"use client";

import { useRef, useState } from "react";
import type { Card } from "@/lib/supabase";
import { api, aud, fileToDataUrl } from "@/lib/client";
import ImagePicker, { type Candidate } from "./ImagePicker";

type Result = {
  card: Record<string, unknown> & { name: string; confidence: string; value_notes?: string };
  aud: { low: number | null; mid: number | null; high: number | null } | null;
  fx: number;
  candidates: Candidate[];
  searchCapped?: boolean;
};

const FIELDS: [keyof Card, string][] = [
  ["name", "Name"], ["subject", "Player / character"], ["set_name", "Collection"], ["card_number", "Card number"],
  ["year", "Year"], ["manufacturer", "Maker"], ["variant", "Variant"], ["graded", "Grading"], ["category", "Category"],
];

/** Photo slot: tap to take a photo or choose one from the library. */
function Slot({ label, current, value, onPick, onClear }: { label: string; current: string | null; value: string | null; onPick: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const shown = value ?? current;
  return (
    <div className="reid-slot">
      <button type="button" className="shot" onClick={() => ref.current?.click()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {shown && <img src={shown} alt={label} />}
        {!shown && <div className="lbl">📷 {label}<small>Tap to add</small></div>}
      </button>
      <div className="small muted">{value ? <>New {label.toLowerCase()} · <button type="button" className="linkish" onClick={onClear}>undo</button></> : current ? `Saved ${label.toLowerCase()} · tap to replace` : `No ${label.toLowerCase()} yet`}</div>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => { if (e.target.files?.[0]) onPick(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

export default function ReIdentify({ card, onClose }: { card: Card; onClose: () => void }) {
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [busy, setBusy] = useState<"" | "identify" | "apply">("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [picture, setPicture] = useState<Candidate | "keep" | "own">("keep");
  const [updateValue, setUpdateValue] = useState(true);

  const pick = (set: (v: string) => void) => async (f: File) => {
    try { set(await fileToDataUrl(f)); setResult(null); } catch { setError("Couldn't read that photo — try another."); }
  };

  async function identify() {
    setBusy("identify"); setError(""); setResult(null);
    try {
      const r = await api<Result>(`/api/cards/${card.id}/reidentify`, { method: "POST", body: JSON.stringify({ step: "identify", front: front ?? undefined, back: back ?? undefined, hint }) });
      setResult(r);
      setCandidates(r.candidates);
      setPicture(r.candidates[0] && (card.image_url === card.photo_url || !card.image_url) ? r.candidates[0] : "keep");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Identification failed");
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!result) return;
    setBusy("apply"); setError("");
    try {
      await api(`/api/cards/${card.id}/reidentify`, {
        method: "POST",
        body: JSON.stringify({
          step: "apply", front: front ?? undefined, back: back ?? undefined, updateValue,
          result: { ...result.card, aud: result.aud, fx: result.fx },
          picture: picture === "keep" || picture === "own" ? picture : { url: picture.url, source: picture.source ?? null },
        }),
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save");
      setBusy("");
    }
  }

  const changed = result ? FIELDS.filter(([k]) => String(card[k] ?? "") !== String(result.card[k as string] ?? "")) : [];

  return (
    <section className="panel stack reid">
      <div className="row">
        <h2 style={{ fontSize: 18 }}>Re-identify this card</h2>
        <span className="spacer" />
        <button className="btn ghost small" onClick={onClose} disabled={busy === "apply"}>Close</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        Uses your saved photos, or add new ones. <b>Add the back</b> if the card number is printed there — it&apos;s the best way to get the number right.
        Nothing changes until you tap <b>Use these details</b>.
      </p>
      <div className="reid-slots">
        <Slot label="Front" current={card.photo_url} value={front} onPick={pick(setFront)} onClear={() => setFront(null)} />
        <Slot label="Back" current={card.back_photo_url} value={back} onPick={pick(setBack)} onClear={() => setBack(null)} />
      </div>
      <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="Optional hint, e.g. “1993-94 SkyBox Premium, Series 2”" />
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      <button className="btn primary" onClick={identify} disabled={!!busy || (!front && !card.photo_url)}>
        {busy === "identify" ? <><span className="spinner" /> Identifying… (15–40 seconds)</> : result ? "Identify again" : "Identify"}
      </button>

      {result && (
        <>
          <div className="row">
            <b>{result.card.name}</b>
            <span className="spacer" />
            <span className={`badge ${result.card.confidence}`}>{result.card.confidence} confidence</span>
          </div>
          {changed.length ? (
            <table className="reid-diff">
              <thead><tr><th></th><th>Now</th><th>New</th></tr></thead>
              <tbody>
                {changed.map(([k, label]) => (
                  <tr key={k}><th>{label}</th><td>{String(card[k] ?? "—") || "—"}</td><td><b>{String(result.card[k as string] ?? "—") || "—"}</b></td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="small" style={{ margin: 0, color: "var(--good)" }}>Same details as now.</p>}

          <label className="switch-row">
            <input type="checkbox" checked={updateValue} onChange={(e) => setUpdateValue(e.target.checked)} />
            <span>Use the new value: <b>{aud(result.aud?.mid ?? null)}</b> <span className="muted small">(now {aud(card.aud_mid)})</span></span>
          </label>
          {result.card.value_notes && <p className="small muted" style={{ margin: 0 }}>{String(result.card.value_notes)}</p>}

          <div className="stack" style={{ gap: 6 }}>
            <b className="small">Picture</b>
            <div className="seg">
              <button className={picture === "keep" ? "on" : ""} onClick={() => setPicture("keep")}>Keep current</button>
              {(front || card.photo_url) && <button className={picture === "own" ? "on" : ""} onClick={() => setPicture("own")}>My photo</button>}
            </div>
            <ImagePicker candidates={candidates} selected={typeof picture === "object" ? picture.url : null} onSelect={(c) => setPicture(c === "own" ? "own" : c)}
              initialQuery={[
                result.card.year && !String(result.card.set_name ?? "").includes(String(result.card.year)) ? result.card.year : null,
                result.card.set_name, result.card.subject ?? result.card.name, result.card.card_number ? `#${result.card.card_number}` : null, "card",
              ].filter(Boolean).join(" ")}
              onCandidates={setCandidates} />
          </div>

          <div className="row">
            <span className="small muted">Quantity, condition and notes stay as they are.</span>
            <span className="spacer" />
            <button className="btn primary" onClick={apply} disabled={!!busy}>
              {busy === "apply" ? <><span className="spinner" /> Saving…</> : "Use these details"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

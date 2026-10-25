"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import CardFields, { fieldsFrom, toPayload, type Fields } from "@/components/CardFields";
import ImagePicker, { type Candidate } from "@/components/ImagePicker";
import { api, aud, fileToDataUrl } from "@/lib/client";

type Range = { low: number; mid: number; high: number };
type IdentifyResult = {
  card: {
    identified: boolean;
    confidence: "high" | "medium" | "low";
    value_usd: Range | null;
    value_notes: string;
    price_sources: { title: string; url: string }[];
    image_query: string;
  } & Record<string, unknown>;
  aud: Range | null;
  fx: number;
  candidates: Candidate[];
  imageSearchEnabled: boolean;
};

function Shot({ label, hint, value, onPick }: { label: string; hint: string; value: string | null; onPick: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="shot" onClick={() => ref.current?.click()} role="button" tabIndex={0}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {value && <img src={value} alt={label} />}
      {!value && <div className="lbl">📷 {label}<small>{hint}</small></div>}
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])} />
    </div>
  );
}

export default function AddCard() {
  const router = useRouter();
  const [front, setFront] = useState<string | null>(null);
  const [back, setBack] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [stage, setStage] = useState<"capture" | "scanning" | "review">("capture");
  const [error, setError] = useState("");
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | "own" | null>(null);
  const [myValue, setMyValue] = useState("");
  const [saving, setSaving] = useState(false);

  const pick = (setter: (s: string) => void) => async (f: File) => {
    setError("");
    try {
      setter(await fileToDataUrl(f));
    } catch {
      setError("Couldn't read that photo — try another.");
    }
  };

  async function identify() {
    if (!front) return;
    setStage("scanning");
    setError("");
    try {
      const res = await api<IdentifyResult>("/api/identify", {
        method: "POST",
        body: JSON.stringify({ images: [front, back].filter(Boolean), hint }),
      });
      setResult(res);
      setFields(fieldsFrom(res.card as Record<string, unknown>));
      setCandidates(res.candidates);
      setSelected(res.candidates[0] ?? "own");
      setMyValue(res.aud ? String(res.aud.mid) : "");
      setStage("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lookup failed");
      setStage(result ? "review" : "capture");
    }
  }

  async function save() {
    if (!fields || !result) return;
    setSaving(true);
    setError("");
    const fx = result.fx;
    const mine = myValue.trim() === "" ? null : Number(myValue);
    const auto = result.aud;
    const valueCols =
      mine != null && isFinite(mine)
        ? {
            aud_mid: mine,
            aud_low: auto && Math.abs(auto.mid - mine) < 0.01 ? auto.low : mine,
            aud_high: auto && Math.abs(auto.mid - mine) < 0.01 ? auto.high : mine,
            value_usd_mid: Math.round((mine / fx) * 100) / 100,
          }
        : { aud_mid: null, aud_low: null, aud_high: null, value_usd_mid: null };

    try {
      const { id } = await api<{ id: string }>("/api/cards", {
        method: "POST",
        body: JSON.stringify({
          ...toPayload(fields),
          ...valueCols,
          fx_usd_aud: fx,
          value_notes: result.card.value_notes,
          price_sources: result.card.price_sources,
          priced_at: new Date().toISOString(),
          confidence: result.card.confidence,
          photo: front,
          useOwnPhoto: selected === "own" || !selected,
          imageUrl: selected && selected !== "own" ? selected.url : undefined,
          imageSource: selected && selected !== "own" ? selected.source : undefined,
        }),
      });
      router.push(`/card/${id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setSaving(false);
    }
  }

  function reset() {
    setFront(null); setBack(null); setHint(""); setResult(null); setFields(null);
    setCandidates([]); setSelected(null); setMyValue(""); setError(""); setStage("capture");
  }

  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 720 }}>
        <h1 style={{ marginBottom: 6 }}>Add a card</h1>
        <p className="muted" style={{ marginTop: 0 }}>Snap the front (and the back if you can — it has the card number and year).</p>

        {error && <p className="error">{error}</p>}

        {stage === "capture" && (
          <div className="stack">
            <div className="shots">
              <Shot label="Front" hint="Required" value={front} onPick={pick(setFront)} />
              <Shot label="Back" hint="Optional, improves accuracy" value={back} onPick={pick(setBack)} />
            </div>
            <label className="field">
              <span>Anything I should know? (optional)</span>
              <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. It's the gold parallel, PSA 8" />
            </label>
            <button className="btn primary block" onClick={identify} disabled={!front}>Identify &amp; value card</button>
          </div>
        )}

        {stage === "scanning" && (
          <div className="panel scanning">
            <span className="spinner big" />
            <div>
              <b>Identifying your card…</b>
              <p className="muted small" style={{ margin: "4px 0 0" }}>Reading the photo, checking recent sales and finding a clean picture. Usually 10–30 seconds.</p>
            </div>
          </div>
        )}

        {stage === "review" && result && fields && (
          <div className="stack">
            <section className="panel stack">
              <div className="row">
                <h2 style={{ fontSize: 18 }}>Choose the picture</h2>
                <span className="spacer" />
                <span className={`badge ${result.card.confidence}`}>{result.card.confidence} confidence</span>
              </div>
              {!result.imageSearchEnabled && !candidates.length && (
                <p className="small muted">Image search isn&apos;t set up (BRAVE_SEARCH_API_KEY), so your photo will be used.</p>
              )}
              {result.imageSearchEnabled && !candidates.length && (
                <p className="small muted">No online picture found — try searching below, or keep your photo.</p>
              )}
              <ImagePicker
                candidates={candidates}
                selected={selected === "own" ? "own" : selected?.url ?? null}
                onSelect={setSelected}
                ownPhoto={front}
                initialQuery={result.card.image_query}
                onCandidates={(c) => { setCandidates(c); if (c[0]) setSelected(c[0]); }}
              />
            </section>

            <section className="panel stack">
              <h2 style={{ fontSize: 18 }}>Estimated value</h2>
              {result.aud ? (
                <div className="value-box">
                  <b>{aud(result.aud.mid)}</b>
                  <span className="muted">range {aud(result.aud.low)} – {aud(result.aud.high)} each</span>
                </div>
              ) : (
                <p className="muted">No sales data found for this card.</p>
              )}
              {result.card.value_notes && <p className="small muted" style={{ margin: 0 }}>{result.card.value_notes}</p>}
              {!!result.card.price_sources.length && (
                <ul className="sources">
                  {result.card.price_sources.map((s) => (
                    <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>
                  ))}
                </ul>
              )}
              <label className="field">
                <span>Value to record (AUD, each)</span>
                <input inputMode="decimal" value={myValue} onChange={(e) => setMyValue(e.target.value)} placeholder="Leave blank if unknown" />
              </label>
            </section>

            <section className="panel stack">
              <div className="row">
                <h2 style={{ fontSize: 18 }}>Card details</h2>
                <span className="spacer" />
              </div>
              <CardFields value={fields} onChange={setFields} />
            </section>

            <section className="panel stack">
              <p className="small muted" style={{ margin: 0 }}>Wrong card? Add a hint and look it up again.</p>
              <div className="row">
                <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. It's from the 1994 Fleer Ultra set" style={{ flex: 1, width: "auto" }} />
                <button className="btn small" onClick={identify}>Retry</button>
              </div>
            </section>

            <div className="row">
              <button className="btn ghost" onClick={reset} disabled={saving}>Start over</button>
              <span className="spacer" />
              <button className="btn primary" onClick={save} disabled={saving}>
                {saving ? <><span className="spinner" /> Saving…</> : "Save to collection"}
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

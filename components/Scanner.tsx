"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import CardFields, { fieldsFrom, toPayload, type Fields } from "@/components/CardFields";
import ImagePicker, { type Candidate } from "@/components/ImagePicker";
import { api, aud, fileToDataUrl } from "@/lib/client";
import { pushAdded } from "@/lib/session-added";
import JustAdded from "@/components/JustAdded";

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

export type PendingCard = { id: string; photo_url: string; back_photo_url: string | null; hint: string | null };

function Shot({ label, hint, value, onPick, locked }: { label: string; hint: string; value: string | null; onPick: (f: File) => void; locked?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="shot" onClick={() => !locked && ref.current?.click()} role="button" tabIndex={0}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {value && <img src={value} alt={label} />}
      {!value && <div className="lbl">{locked ? "No photo" : <>📷 {label}<small>{hint}</small></>}</div>}
      <input ref={ref} type="file" accept="image/*" capture="environment" onChange={(e) => { if (e.target.files?.[0]) onPick(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}

export default function Scanner({ pending, waiting: initialWaiting = 0 }: { pending?: PendingCard | null; waiting?: number }) {
  const router = useRouter();
  const [front, setFront] = useState<string | null>(pending?.photo_url ?? null);
  const [back, setBack] = useState<string | null>(pending?.back_photo_url ?? null);
  const [hint, setHint] = useState(pending?.hint ?? "");
  const [stage, setStage] = useState<"capture" | "scanning" | "review">("capture");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [fields, setFields] = useState<Fields | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | "own" | null>(null);
  const [myValue, setMyValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [queueing, setQueueing] = useState("");
  const [waiting, setWaiting] = useState(initialWaiting);
  const manyRef = useRef<HTMLInputElement>(null);

  const pick = (setter: (s: string) => void) => async (f: File) => {
    setError(""); setNotice("");
    try {
      setter(await fileToDataUrl(f));
    } catch {
      setError("Couldn't read that photo — try another.");
    }
  };

  async function identify() {
    if (!front) return;
    setStage("scanning");
    setError(""); setNotice("");
    try {
      const res = await api<IdentifyResult>("/api/identify", {
        method: "POST",
        body: JSON.stringify(pending ? { pendingId: pending.id, hint } : { images: [front, back].filter(Boolean), hint }),
      });
      setResult(res);
      setFields(fieldsFrom(res.card as Record<string, unknown>));
      setCandidates(res.candidates);
      setSelected(res.candidates[0] ?? "own");
      setMyValue(res.aud ? String(res.aud.mid) : "");
      setStage("review");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Lookup failed";
      setError(pending ? `${msg} — it's still safe in your waiting list.` : `${msg} — your photos are still here. Tap "Save for later" to keep them and try again later.`);
      setStage(result ? "review" : "capture");
    }
  }

  /** Save the current photos to the waiting list and clear the form for the next card. */
  async function saveForLater() {
    if (!front || pending) return;
    setQueueing("Saving…"); setError(""); setNotice("");
    try {
      const r = await api<{ waiting: number | null }>("/api/pending", { method: "POST", body: JSON.stringify({ front, back, hint }) });
      setWaiting(r.waiting ?? waiting + 1);
      reset();
      setNotice("Saved to your waiting list. Snap the next card.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo");
    } finally {
      setQueueing("");
    }
  }

  /** Upload a batch of photos (fronts) straight to the waiting list. */
  async function uploadMany(files: FileList) {
    const list = Array.from(files);
    if (!list.length) return;
    setError(""); setNotice("");
    let done = 0;
    const failed: string[] = [];
    for (const f of list) {
      setQueueing(`Saving ${done + 1} of ${list.length}…`);
      try {
        const r = await api<{ waiting: number | null }>("/api/pending", { method: "POST", body: JSON.stringify({ front: await fileToDataUrl(f) }) });
        if (r.waiting != null) setWaiting(r.waiting);
        done++;
      } catch (e) {
        failed.push(`${f.name}: ${e instanceof Error ? e.message : "failed"}`);
        if (e instanceof Error && /database needs/i.test(e.message)) break;
      }
    }
    setQueueing("");
    if (done) setNotice(`${done} photo${done === 1 ? "" : "s"} saved to your waiting list.`);
    if (failed.length) setError(`Some photos didn't save — ${failed.slice(0, 3).join("; ")}`);
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

    const payload = {
      ...toPayload(fields),
      ...valueCols,
      fx_usd_aud: fx,
      value_notes: result.card.value_notes,
      price_sources: result.card.price_sources,
      priced_at: new Date().toISOString(),
      confidence: result.card.confidence,
      useOwnPhoto: selected === "own" || !selected,
      imageUrl: selected && selected !== "own" ? selected.url : undefined,
      imageSource: selected && selected !== "own" ? selected.source : undefined,
    };

    try {
      if (pending) {
        await api(`/api/cards/${pending.id}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, status: "catalogued", last_error: null, hint: hint || null }),
        });
        pushAdded(pending.id);
        router.push("/pending");
        router.refresh();
        return;
      }
      const { id } = await api<{ id: string }>("/api/cards", { method: "POST", body: JSON.stringify({ ...payload, photo: front }) });
      pushAdded(id);
      const savedName = fields.name.trim() || "Card";
      reset();
      setSaving(false);
      setNotice(`Saved “${savedName}”. Snap the next card — it's in the list below.`);
      window.scrollTo({ top: 0, behavior: "smooth" });
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
    <main className="wrap" style={{ maxWidth: 720 }}>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1>{pending ? "Identify saved card" : "Add a card"}</h1>
        <span className="spacer" />
        {(waiting > 0 || pending) && <Link href="/pending" className="btn ghost small">Waiting list{waiting ? ` (${waiting})` : ""}</Link>}
      </div>
      {!pending && (
        <p className="muted" style={{ marginTop: 0 }}>Snap the front (and the back if you can — it has the card number and year).</p>
      )}

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {stage === "capture" && (
        <div className="stack">
          <div className="shots">
            <Shot label="Front" hint="Required" value={front} onPick={pick(setFront)} locked={!!pending} />
            <Shot label="Back" hint="Optional, improves accuracy" value={back} onPick={pick(setBack)} locked={!!pending} />
          </div>
          <label className="field">
            <span>Anything I should know? (optional)</span>
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. It's the gold parallel, PSA 8" />
          </label>

          {pending ? (
            <button className="btn primary block" onClick={identify}>Identify &amp; value card</button>
          ) : (
            <>
              <div className="btn-row">
                <button className="btn" onClick={saveForLater} disabled={!front || !!queueing}>
                  {queueing && queueing === "Saving…" ? <><span className="spinner" /> Saving…</> : "Save for later"}
                </button>
                <button className="btn primary" onClick={identify} disabled={!front || !!queueing}>Identify now</button>
              </div>
              <p className="small muted" style={{ margin: 0, textAlign: "center" }}>
                &ldquo;Save for later&rdquo; stores the photos straight away so nothing&apos;s lost — identify them whenever you like.
              </p>

              <div className="or">or</div>
              <div className="upload-many" onClick={() => !queueing && manyRef.current?.click()} role="button" tabIndex={0}>
                {queueing && queueing !== "Saving…" ? (
                  <span className="row" style={{ justifyContent: "center" }}><span className="spinner" /> {queueing}</span>
                ) : (
                  <>
                    <b style={{ color: "var(--text)" }}>Upload several photos</b>
                    <div className="small">Pick a batch from your camera roll — one card per photo. They go to your waiting list.</div>
                  </>
                )}
                <input ref={manyRef} type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files) uploadMany(e.target.files); e.target.value = ""; }} />
              </div>
            </>
          )}
        </div>
      )}

      {stage === "capture" && !pending && (
        <div style={{ marginTop: 22 }}>
          <JustAdded />
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
            <h2 style={{ fontSize: 18 }}>Card details</h2>
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
            {pending ? (
              <Link href="/pending" className="btn ghost">Back to waiting list</Link>
            ) : (
              <>
                <button className="btn ghost" onClick={reset} disabled={saving}>Start over</button>
                <button className="btn ghost" onClick={saveForLater} disabled={saving || !!queueing}>Save for later</button>
              </>
            )}
            <span className="spacer" />
            <button className="btn primary" onClick={save} disabled={saving}>
              {saving ? <><span className="spinner" /> Saving…</> : "Save to collection"}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Card } from "@/lib/supabase";
import { api, aud } from "@/lib/client";
import CardFields, { fieldsFrom, toPayload, type Fields } from "./CardFields";
import ImagePicker, { type Candidate } from "./ImagePicker";

export default function CardDetail({ card: initial }: { card: Card }) {
  const router = useRouter();
  const [card, setCard] = useState(initial);
  const [fields, setFields] = useState<Fields>(fieldsFrom(initial as unknown as Record<string, unknown>));
  const [myValue, setMyValue] = useState(initial.aud_mid != null ? String(initial.aud_mid) : "");
  const [busy, setBusy] = useState<"" | "save" | "price" | "delete" | "image">("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [changingImage, setChangingImage] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);

  const searchQuery = [card.year, card.manufacturer, card.set_name, card.subject || card.name, card.card_number && `#${card.card_number}`, card.variant, "card"]
    .filter(Boolean).join(" ");

  async function save() {
    setBusy("save"); setError(""); setSaved(false);
    try {
      const mine = myValue.trim() === "" ? null : Number(myValue);
      const valueCols =
        mine !== card.aud_mid
          ? mine != null && isFinite(mine)
            ? { aud_mid: mine, aud_low: mine, aud_high: mine, value_usd_mid: card.fx_usd_aud ? Math.round((mine / card.fx_usd_aud) * 100) / 100 : null }
            : { aud_mid: null, aud_low: null, aud_high: null, value_usd_mid: null }
          : {};
      await api(`/api/cards/${card.id}`, { method: "PATCH", body: JSON.stringify({ ...toPayload(fields), ...valueCols }) });
      setCard({ ...card, ...(toPayload(fields) as Partial<Card>), ...valueCols });
      setSaved(true);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function reprice() {
    setBusy("price"); setError("");
    try {
      const v = await api<Partial<Card>>(`/api/cards/${card.id}/reprice`, { method: "POST" });
      setCard({ ...card, ...v });
      setMyValue(v.aud_mid != null ? String(v.aud_mid) : "");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pricing failed");
    } finally {
      setBusy("");
    }
  }

  async function changeImage(c: Candidate | "own") {
    setBusy("image"); setError("");
    try {
      await api(`/api/cards/${card.id}`, {
        method: "PATCH",
        body: JSON.stringify(c === "own" ? { useOwnPhoto: true } : { imageUrl: c.url, imageSource: c.source }),
      });
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't change the picture");
      setBusy("");
    }
  }

  async function remove() {
    if (!confirm(`Delete "${card.name}" from your collection?`)) return;
    setBusy("delete");
    try {
      await api(`/api/cards/${card.id}`, { method: "DELETE" });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setBusy("");
    }
  }

  return (
    <div className="stack">
      <Link href="/" className="muted small">← Collection</Link>
      {error && <p className="error">{error}</p>}

      <div className="detail">
        <div className="stack">
          <div className="hero-art">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {card.image_url && <img src={card.image_url} alt={card.name} />}
          </div>
          <div className="row">
            <button className="btn small" onClick={() => setChangingImage((v) => !v)} disabled={!!busy}>
              {changingImage ? "Cancel" : "Change picture"}
            </button>
            {card.photo_url && card.photo_url !== card.image_url && (
              <a className="btn ghost small" href={card.photo_url} target="_blank" rel="noreferrer">View my photo</a>
            )}
            {card.image_source && (
              <a className="btn ghost small" href={card.image_source} target="_blank" rel="noreferrer">Image source</a>
            )}
          </div>
          {changingImage && (
            <div className="panel">
              {busy === "image" ? (
                <div className="row"><span className="spinner" /> Saving picture…</div>
              ) : (
                <ImagePicker
                  candidates={candidates}
                  selected={null}
                  onSelect={changeImage}
                  ownPhoto={card.photo_url}
                  initialQuery={searchQuery}
                  onCandidates={setCandidates}
                />
              )}
            </div>
          )}
        </div>

        <div className="stack">
          <div>
            <p className="muted small" style={{ margin: 0 }}>{card.category}{card.set_name ? ` · ${card.set_name}` : ""}</p>
            <h1>{card.name}</h1>
          </div>

          <section className="panel stack">
            <div className="row">
              <h2 style={{ fontSize: 18 }}>Value</h2>
              <span className="spacer" />
              {card.confidence && <span className={`badge ${card.confidence}`}>{card.confidence} confidence</span>}
            </div>
            <div className="value-box">
              <b>{aud(card.aud_mid)}</b>
              {card.aud_low != null && card.aud_high != null && card.aud_low !== card.aud_high && (
                <span className="muted">range {aud(card.aud_low)} – {aud(card.aud_high)}</span>
              )}
              {card.quantity > 1 && card.aud_mid != null && <span className="muted">· {aud(card.aud_mid * card.quantity)} for {card.quantity}</span>}
            </div>
            {card.value_notes && <p className="small muted" style={{ margin: 0 }}>{card.value_notes}</p>}
            {!!card.price_sources?.length && (
              <ul className="sources">
                {card.price_sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></li>)}
              </ul>
            )}
            <div className="row">
              <span className="small muted">
                {card.priced_at ? `Priced ${new Date(card.priced_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}` : "Not priced yet"}
              </span>
              <span className="spacer" />
              <button className="btn small" onClick={reprice} disabled={!!busy}>
                {busy === "price" ? <><span className="spinner" /> Checking sales…</> : "Update value"}
              </button>
            </div>
            <label className="field">
              <span>Recorded value (AUD, each)</span>
              <input inputMode="decimal" value={myValue} onChange={(e) => setMyValue(e.target.value)} placeholder="Unknown" />
            </label>
          </section>

          <section className="panel">
            <CardFields value={fields} onChange={(f) => { setFields(f); setSaved(false); }} />
          </section>

          <div className="row">
            <button className="btn ghost danger" onClick={remove} disabled={!!busy}>Delete</button>
            <span className="spacer" />
            {saved && <span className="small" style={{ color: "var(--good)" }}>Saved</span>}
            <button className="btn primary" onClick={save} disabled={!!busy}>
              {busy === "save" ? <><span className="spinner" /> Saving…</> : "Save changes"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

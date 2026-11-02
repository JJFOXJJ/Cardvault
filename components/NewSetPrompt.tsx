"use client";

import Link from "next/link";
import { useState } from "react";
import { useTrackSet, type TrackResult } from "@/lib/track";

/** Shown after saving a card from a set that isn't in the vault yet. */
export default function NewSetPrompt({ name, image, onClose }: { name: string; image?: string | null; onClose: () => void }) {
  const { track, decline, stage, busy } = useTrackSet();
  const [choice, setChoice] = useState<"set" | "single">("set");
  const [done, setDone] = useState<TrackResult | null>(null);

  async function go() {
    if (choice === "single") {
      await decline(name);
      onClose();
      return;
    }
    setDone(await track(name));
  }

  return (
    <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="New set">
      <div className="sheet-dim" onClick={() => !busy && onClose()} />
      <div className="sheet">
        <div className="grab" />
        <div className="row" style={{ gap: 12, flexWrap: "nowrap" }}>
          {image && (
            <div className="sheet-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={image} alt="" />
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div className="small muted">New set in your vault</div>
            <h2 style={{ fontSize: 18, marginTop: 2 }}>{name}</h2>
          </div>
        </div>

        {busy ? (
          <div className="scanning" style={{ padding: "26px 0 10px" }}>
            <span className="spinner big" />
            <p className="muted small" style={{ margin: 0 }}>{stage}</p>
          </div>
        ) : done ? (
          <div className="stack" style={{ marginTop: 16 }}>
            {done.error ? (
              <p className="error" style={{ margin: 0 }}>{done.error} You can paste a checklist on the set page.</p>
            ) : (
              <p className="notice" style={{ margin: 0 }}>Checklist ready: <b>{done.total} cards</b>. Tick off the ones you have.</p>
            )}
            {done.id && <Link href={`/sets/${done.id}`} className="btn primary block">Open the checklist</Link>}
            <button className="btn block" onClick={onClose}>Scan another card</button>
          </div>
        ) : (
          <>
            <button className={`opt ${choice === "set" ? "on" : ""}`} onClick={() => setChoice("set")}>
              <span className="rad" />
              <span><b>Track the whole set</b><span className="small muted">Shows every card in the set so you can tick off the ones you have — no scanning needed.</span></span>
            </button>
            <button className={`opt ${choice === "single" ? "on" : ""}`} onClick={() => setChoice("single")}>
              <span className="rad" />
              <span><b>Just this card</b><span className="small muted">Keep it as a plain collection. You can track the set later from the Sets tab.</span></span>
            </button>
            <div className="stack" style={{ marginTop: 16, gap: 10 }}>
              <button className="btn primary block" onClick={go}>{choice === "set" ? "Find the checklist" : "Done"}</button>
              <button className="btn ghost block" onClick={onClose}>Ask me later</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

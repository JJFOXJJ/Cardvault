"use client";

import { useEffect, useState } from "react";

const MAX = 8;

export default function Login() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  async function submit(value = pin) {
    if (!value || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Wrong PIN");
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  const press = (d: string) => setPin((p) => (p.length < MAX ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="pin-wrap">
      <div className="pin-card">
        <span className="brand-mark" style={{ display: "inline-block", width: 40, height: 54 }} aria-hidden />
        <h1 style={{ marginTop: 18 }}>Card Vault</h1>
        <p className="muted">Enter your PIN</p>

        <div className={`dots ${shake ? "shake" : ""}`} aria-label={`${pin.length} digits entered`}>
          {Array.from({ length: Math.max(6, pin.length) }).map((_, i) => (
            <i key={i} className={i < pin.length ? "on" : ""} />
          ))}
        </div>

        <div className="keys">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <button key={d} className="key" onClick={() => press(d)} disabled={busy}>{d}</button>
          ))}
          <button className="key alt" onClick={back} disabled={busy} aria-label="Delete">⌫</button>
          <button className="key" onClick={() => press("0")} disabled={busy}>0</button>
          <button className="key alt" onClick={() => submit()} disabled={busy || !pin} style={{ color: "var(--accent)" }}>
            {busy ? <span className="spinner" style={{ margin: "0 auto" }} /> : "Enter"}
          </button>
        </div>

        <p style={{ minHeight: 24, marginTop: 16 }} className="small" role="alert">
          {error && <span style={{ color: "var(--bad)" }}>{error}</span>}
        </p>
      </div>
    </div>
  );
}

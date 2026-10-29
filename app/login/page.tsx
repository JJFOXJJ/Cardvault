"use client";

import { useEffect, useState } from "react";

const MAX = 12;
type P = { id: string; name: string };
type Info = { setup?: boolean; profiles?: P[]; needsMigration?: boolean };

function PinPad({ busy, onSubmit, error, title, subtitle, onBack }: {
  busy: boolean; onSubmit: (pin: string) => Promise<boolean>; error: string; title: string; subtitle?: string; onBack?: () => void;
}) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);

  async function submit(value = pin) {
    if (!value || busy) return;
    const ok = await onSubmit(value);
    if (!ok) {
      setShake(true);
      setTimeout(() => setShake(false), 400);
      setPin("");
    }
  }
  const press = (d: string) => setPin((p) => (p.length < MAX ? p + d : p));
  const back = () => setPin((p) => p.slice(0, -1));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else if (e.key === "Enter") submit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <h1 style={{ marginTop: 18 }}>{title}</h1>
      {subtitle && <p className="muted" style={{ margin: "4px 0 0" }}>{subtitle}</p>}

      <div className={`dots ${shake ? "shake" : ""}`} aria-label={`${pin.length} digits entered`}>
        {Array.from({ length: Math.max(6, pin.length) }).map((_, i) => <i key={i} className={i < pin.length ? "on" : ""} />)}
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
      {onBack && <button className="btn ghost small" onClick={onBack}>← Switch profile</button>}
    </>
  );
}

export default function Login() {
  const [info, setInfo] = useState<Info | null>(null);
  const [chosen, setChosen] = useState<P | null>(null);
  const [setupName, setSetupName] = useState("");
  const [nameDone, setNameDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => r.json())
      .then((d: Info) => {
        setInfo(d);
        const list = d.profiles ?? [];
        let last: string | null = null;
        try { last = localStorage.getItem("cv_last_profile"); } catch { /* ignore */ }
        const pre = list.length === 1 ? list[0] : list.find((p) => p.id === last);
        if (pre) setChosen(pre);
      })
      .catch(() => setError("Couldn't reach the site — check your connection."));
  }, []);

  async function post(body: object) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (res.ok) {
        try { sessionStorage.clear(); } catch { /* ignore */ }
        window.location.href = "/";
        return true;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error || "Wrong PIN");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function choose(p: P | null) {
    setChosen(p);
    setError("");
    try { if (p) localStorage.setItem("cv_last_profile", p.id); } catch { /* ignore */ }
  }

  return (
    <div className="pin-wrap">
      <div className="pin-card">
        <span className="brand-mark" style={{ display: "inline-block", width: 40, height: 54 }} aria-hidden />

        {!info && !error && <div style={{ marginTop: 30 }}><span className="spinner" style={{ margin: "0 auto" }} /></div>}
        {!info && error && <p className="error" style={{ marginTop: 20 }}>{error}</p>}

        {info?.needsMigration && (
          <div style={{ marginTop: 18 }}>
            <h1>One quick update</h1>
            <p className="muted">
              Profiles need a small database change. In Supabase, open <b>SQL Editor</b>, paste the contents of{" "}
              <code>supabase/migrations/003_profiles.sql</code> from your GitHub repo, tap <b>Run</b>, then reload this page.
            </p>
          </div>
        )}

        {/* First-time setup: name, then the existing site PIN */}
        {info?.setup && !nameDone && (
          <form onSubmit={(e) => { e.preventDefault(); if (setupName.trim()) setNameDone(true); }} className="stack" style={{ marginTop: 18 }}>
            <h1>Set up your profile</h1>
            <p className="muted" style={{ margin: 0 }}>Card Vault now supports separate profiles. Your existing cards will be moved into yours.</p>
            <input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="Your name" autoFocus maxLength={40} style={{ textAlign: "center", fontSize: 18 }} />
            <button className="btn primary block" disabled={!setupName.trim()}>Next</button>
          </form>
        )}
        {info?.setup && nameDone && (
          <PinPad
            busy={busy}
            error={error}
            title={`Hi ${setupName.trim()}`}
            subtitle="Enter your current site PIN to finish. It stays your PIN — you can change it later."
            onSubmit={(pin) => post({ setup: true, name: setupName.trim(), pin })}
            onBack={() => setNameDone(false)}
          />
        )}

        {/* Choose a profile */}
        {info && !info.setup && !info.needsMigration && !chosen && (
          <div className="stack" style={{ marginTop: 18 }}>
            <h1>Who&apos;s collecting?</h1>
            <div className="profile-pick">
              {(info.profiles ?? []).map((p) => (
                <button key={p.id} className="profile-btn" onClick={() => choose(p)}>
                  <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* PIN for the chosen profile */}
        {info && !info.setup && chosen && (
          <PinPad
            busy={busy}
            error={error}
            title={chosen.name}
            subtitle="Enter your PIN"
            onSubmit={(pin) => post({ profileId: chosen.id, pin })}
            onBack={(info.profiles?.length ?? 0) > 1 ? () => choose(null) : undefined}
          />
        )}
      </div>
    </div>
  );
}

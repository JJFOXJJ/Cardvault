"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client";
import { UsageMeter } from "./Usage";

type P = { id: string; name: string; is_admin: boolean; created_at: string; cards?: number };
type Data = { me: { id: string; name: string; is_admin: boolean }; profiles: P[] };

const pinOk = (p: string) => /^\d{4,12}$/.test(p);

export default function Profiles() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  // My profile
  const [myName, setMyName] = useState("");
  const [curPin, setCurPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newPin2, setNewPin2] = useState("");

  // Add profile (admin)
  const [addName, setAddName] = useState("");
  const [addPin, setAddPin] = useState("");

  async function load() {
    const d = await api<Data>("/api/profiles");
    setData(d);
    try { sessionStorage.setItem("cv_me", d.me.name); } catch { /* ignore */ }
    setMyName(d.me.name);
  }
  useEffect(() => { load().catch((e) => setError(e.message)); }, []);

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setError(""); setNotice("");
    try {
      await fn();
      setNotice(ok);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      return false;
    } finally {
      setBusy("");
    }
  }

  if (!data) return error ? <p className="error">{error}</p> : <div className="scanning"><span className="spinner big" /></div>;
  const { me, profiles } = data;

  return (
    <div className="stack">
      <div>
        <h1>Profiles</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>
          Each profile has its own PIN and its own cards, collections and waiting list. Nobody can see another profile&apos;s cards.
        </p>
      </div>

      <UsageMeter />
      <Link href="/usage" className="small muted" style={{ marginTop: -6 }}>See usage by profile →</Link>

      {notice && <p className="notice">{notice}</p>}
      {error && <p className="error">{error}</p>}

      <section className="panel stack">
        <h2 style={{ fontSize: 18 }}>You{me.is_admin ? " · admin" : ""}</h2>
        <form className="row" onSubmit={(e) => { e.preventDefault(); run("name", () => api(`/api/profiles/${me.id}`, { method: "PATCH", body: JSON.stringify({ name: myName }) }), "Name updated."); }}>
          <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={40} style={{ flex: 1, width: "auto" }} aria-label="Your name" />
          <button className="btn small" disabled={!!busy || !myName.trim() || myName.trim() === me.name}>Save name</button>
        </form>

        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (newPin !== newPin2) return setError("The new PINs don't match.");
            const ok = await run("pin", () => api(`/api/profiles/${me.id}`, { method: "PATCH", body: JSON.stringify({ pin: newPin, currentPin: curPin }) }),
              "PIN changed. Other devices signed in as you have been signed out.");
            if (ok) { setCurPin(""); setNewPin(""); setNewPin2(""); }
          }}
        >
          <b className="small">Change your PIN</b>
          <div className="grid-3">
            <input type="password" inputMode="numeric" autoComplete="current-password" placeholder="Current PIN" value={curPin} onChange={(e) => setCurPin(e.target.value.replace(/\D/g, ""))} />
            <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN" value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} />
            <input type="password" inputMode="numeric" autoComplete="new-password" placeholder="New PIN again" value={newPin2} onChange={(e) => setNewPin2(e.target.value.replace(/\D/g, ""))} />
          </div>
          <div className="row">
            <span className="small muted">4–12 digits.</span>
            <span className="spacer" />
            <button className="btn small" disabled={!!busy || !curPin || !pinOk(newPin) || !newPin2}>{busy === "pin" ? <span className="spinner" /> : "Change PIN"}</button>
          </div>
        </form>
      </section>

      {me.is_admin && (
        <>
          <section className="panel stack">
            <h2 style={{ fontSize: 18 }}>Add a profile</h2>
            <p className="small muted" style={{ margin: 0 }}>Choose a starting PIN and tell them — they can change it from this page once they sign in.</p>
            <form
              className="row"
              onSubmit={async (e) => {
                e.preventDefault();
                const ok = await run("add", () => api("/api/profiles", { method: "POST", body: JSON.stringify({ name: addName, pin: addPin }) }), `Profile “${addName.trim()}” created.`);
                if (ok) { setAddName(""); setAddPin(""); }
              }}
            >
              <input value={addName} onChange={(e) => setAddName(e.target.value)} placeholder="Name" maxLength={40} style={{ flex: "2 1 140px", width: "auto" }} />
              <input value={addPin} onChange={(e) => setAddPin(e.target.value.replace(/\D/g, ""))} placeholder="Starting PIN" inputMode="numeric" style={{ flex: "1 1 110px", width: "auto" }} />
              <button className="btn primary small" disabled={!!busy || !addName.trim() || !pinOk(addPin)}>{busy === "add" ? <span className="spinner" /> : "Add"}</button>
            </form>
          </section>

          <section className="panel coll-list">
            {profiles.map((p) => (
              <div key={p.id} className="coll-row" style={{ cursor: "default", flexWrap: "wrap" }}>
                <span className="avatar">{p.name.slice(0, 1).toUpperCase()}</span>
                <div style={{ flex: "1 1 140px", minWidth: 0 }}>
                  <div className="t">{p.name}{p.id === me.id ? " (you)" : ""}</div>
                  <div className="small muted">{p.cards ?? 0} card{p.cards === 1 ? "" : "s"}{p.is_admin ? " · admin" : ""}</div>
                </div>
                {p.id !== me.id && (
                  <div className="row" style={{ gap: 4 }}>
                    <button className="btn ghost small" disabled={!!busy} onClick={() => {
                      const pin = window.prompt(`New PIN for ${p.name} (4–12 digits). This signs them out everywhere.`);
                      if (pin == null) return;
                      if (!pinOk(pin)) return setError("PINs must be 4–12 digits.");
                      run(`pin-${p.id}`, () => api(`/api/profiles/${p.id}`, { method: "PATCH", body: JSON.stringify({ pin }) }), `PIN reset for ${p.name}.`);
                    }}>Reset PIN</button>
                    <button className="btn ghost small" disabled={!!busy} onClick={() =>
                      run(`adm-${p.id}`, () => api(`/api/profiles/${p.id}`, { method: "PATCH", body: JSON.stringify({ is_admin: !p.is_admin }) }), p.is_admin ? `${p.name} is no longer an admin.` : `${p.name} is now an admin.`)
                    }>{p.is_admin ? "Remove admin" : "Make admin"}</button>
                    <button className="btn ghost small danger" disabled={!!busy} onClick={() => {
                      const typed = window.prompt(`This permanently deletes ${p.name}'s profile and all ${p.cards ?? 0} of their cards.\n\nType "${p.name}" to confirm.`);
                      if (typed == null) return;
                      run(`del-${p.id}`, () => api(`/api/profiles/${p.id}`, { method: "DELETE", body: JSON.stringify({ confirmName: typed }) }), `${p.name}'s profile was deleted.`);
                    }}>Delete</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}

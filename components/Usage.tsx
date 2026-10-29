"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Summary = {
  available: boolean;
  brave: { used: number; limit: number; resetsAt: string; scansLeft: number; byProfile: { name: string; count: number }[] };
  gemini: { used: number; resetsAt: string; byProfile: { name: string; count: number }[] };
};

let cache: { at: number; p: Promise<Summary | null> } | null = null;
function loadUsage(force = false): Promise<Summary | null> {
  if (!force && cache && Date.now() - cache.at < 30_000) return cache.p;
  const p = fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).catch(() => null);
  cache = { at: Date.now(), p };
  return p;
}

export function useUsage(force = false) {
  const [u, setU] = useState<Summary | null>(null);
  useEffect(() => {
    let live = true;
    loadUsage(force).then((d) => live && setU(d));
    return () => { live = false; };
  }, [force]);
  return u;
}

/** "12 days 4 hrs", "3 hrs 20 min", "45 min" — ticks every 30 seconds. */
export function Countdown({ to }: { to: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  const text = d >= 1 ? `${d} day${d === 1 ? "" : "s"} ${h} hr${h === 1 ? "" : "s"}` : h >= 1 ? `${h} hr${h === 1 ? "" : "s"} ${m} min` : `${Math.max(1, m)} min`;
  return <span>{text}</span>;
}

const level = (used: number, limit: number) => (limit && used >= limit ? "full" : limit && used / limit >= 0.8 ? "warn" : "ok");

/** One-line meter for the home and Add card screens. */
export function UsageMeter() {
  const u = useUsage();
  if (!u?.available) return null;
  const { used, limit, scansLeft, resetsAt } = u.brave;
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const lv = level(used, limit);
  return (
    <Link href="/usage" className={`usage-meter ${lv}`} title="Shared free allowance — tap for details">
      <div className="row" style={{ gap: 8 }}>
        <span className="small">
          {lv === "full" ? <b>Free searches used up</b> : <><b>~{scansLeft}</b> scans left this month</>}
          <span className="muted"> · resets in <Countdown to={resetsAt} /></span>
        </span>
        <span className="spacer" />
        <span className="small muted">{used}/{limit}</span>
      </div>
      <div className="progress"><i style={{ width: `${pct}%` }} /></div>
    </Link>
  );
}

/** Full usage page. */
export default function UsagePage() {
  const u = useUsage(true);
  if (!u) return <div className="scanning"><span className="spinner big" /></div>;

  if (!u.available) {
    return (
      <div className="stack">
        <h1>Usage</h1>
        <p className="error">
          The usage counter needs a quick database update. In Supabase, open <b>SQL Editor</b>, run the contents of{" "}
          <code>supabase/migrations/004_usage.sql</code> from your GitHub repo, then refresh. Counting starts from then.
        </p>
      </div>
    );
  }

  const b = u.brave, g = u.gemini;
  const pct = b.limit ? Math.min(100, (b.used / b.limit) * 100) : 0;
  const lv = level(b.used, b.limit);
  const resetDate = new Date(b.resetsAt).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const gReset = new Date(g.resetsAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" });

  return (
    <div className="stack">
      <div>
        <h1>Usage</h1>
        <p className="muted" style={{ margin: "4px 0 0" }}>Everyone shares the same free allowance, so this covers all profiles.</p>
      </div>

      <section className={`panel stack usage-panel ${lv}`}>
        <div className="row">
          <h2 style={{ fontSize: 18 }}>Brave searches this month</h2>
          <span className="spacer" />
          <b>{b.used} / {b.limit}</b>
        </div>
        <div className="progress big"><i style={{ width: `${pct}%` }} /></div>
        <div className="usage-stats">
          <div><b>~{b.scansLeft}</b><span>scans left</span></div>
          <div><b><Countdown to={b.resetsAt} /></b><span>until reset ({resetDate})</span></div>
          <div><b>${((b.used / 1000) * 5).toFixed(2)}</b><span>of the $5 free credit</span></div>
        </div>
        {lv === "full" ? (
          <p className="error" style={{ margin: 0 }}>
            The free searches for this month are used up, so the app has stopped using Brave to avoid charges. Scanning still works — it uses your photo and Gemini&apos;s own estimate for the value. Everything switches back on when the month resets.
          </p>
        ) : lv === "warn" ? (
          <p className="small" style={{ margin: 0, color: "var(--accent)" }}>Over 80% used. Consider “Save for later” and identifying after the reset.</p>
        ) : null}
        <p className="small muted" style={{ margin: 0 }}>
          A scan uses about 2 searches (prices + picture). “Update value” and “Search for a different picture” use 1 each.
        </p>
        {!!b.byProfile.length && <ByProfile rows={b.byProfile} total={b.used} unit="search" />}
      </section>

      <section className="panel stack">
        <div className="row">
          <h2 style={{ fontSize: 18 }}>Gemini requests today</h2>
          <span className="spacer" />
          <b>{g.used}</b>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Gemini&apos;s free tier has daily limits (no charges). If scans start failing with “busy or at its limit”, wait for the reset in{" "}
          <b style={{ color: "var(--text)" }}><Countdown to={g.resetsAt} /></b> (at {gReset} your time). A scan uses about 2 requests.
        </p>
        {!!g.byProfile.length && <ByProfile rows={g.byProfile} total={g.used} unit="request" />}
      </section>
    </div>
  );
}

function ByProfile({ rows, total, unit }: { rows: { name: string; count: number }[]; total: number; unit: string }) {
  return (
    <div className="by-profile">
      {rows.map((r) => (
        <div key={r.name} className="row" style={{ gap: 10 }}>
          <span className="avatar small">{r.name.slice(0, 1).toUpperCase()}</span>
          <span style={{ flex: "0 1 120px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
          <div className="progress" style={{ flex: 1 }}><i style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} /></div>
          <span className="small muted" style={{ minWidth: 70, textAlign: "right" }}>{r.count} {r.count === 1 ? unit : unit === "search" ? "searches" : `${unit}s`}</span>
        </div>
      ))}
    </div>
  );
}

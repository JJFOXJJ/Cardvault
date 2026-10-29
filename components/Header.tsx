"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { clearAdded } from "@/lib/session-added";

/** Where "back" should go if there's no earlier page in this tab (e.g. opened from a link). */
function parentOf(path: string, pending: string | null) {
  if (path.startsWith("/add") && pending) return "/pending";
  return "/";
}

function BackButton() {
  const router = useRouter();
  const path = usePathname();
  const pending = useSearchParams().get("pending");
  if (path === "/") return null;

  function goBack() {
    // Leaving the adding screens ends the "Just added" session.
    if ((path === "/add" && !pending) || path === "/pending") clearAdded();
    const fromThisSite = typeof document !== "undefined" && document.referrer.startsWith(window.location.origin);
    if (fromThisSite && window.history.length > 1) router.back();
    else router.push(parentOf(path, pending));
  }

  return (
    <button className="back-btn" onClick={goBack} aria-label="Back" title="Back">
      ←
    </button>
  );
}

function WhoAmI() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let cached: string | null = null;
    try { cached = sessionStorage.getItem("cv_me"); } catch { /* ignore */ }
    if (cached) { setName(cached); return; }
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name?: string } | null) => {
        if (!d?.name) return;
        setName(d.name);
        try { sessionStorage.setItem("cv_me", d.name); } catch { /* ignore */ }
      })
      .catch(() => {});
  }, []);
  if (!name) return null;
  return (
    <Link href="/profiles" className="me-chip" title="Profiles & PIN">
      <span className="avatar small">{name.slice(0, 1).toUpperCase()}</span>
      <span className="me-name">{name}</span>
    </Link>
  );
}

export default function Header() {
  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    try { sessionStorage.clear(); } catch { /* ignore */ }
    window.location.href = "/login";
  }
  return (
    <header className="top">
      <div className="wrap">
        <Suspense fallback={null}>
          <BackButton />
        </Suspense>
        <Link href="/" className="brand">
          <span className="brand-mark" aria-hidden /> Card Vault
        </Link>
        <nav>
          <WhoAmI />
          <Link href="/add" className="btn primary small">+ Add card</Link>
          <button className="btn ghost small" onClick={logout} title="Lock">Lock</button>
        </nav>
      </div>
    </header>
  );
}

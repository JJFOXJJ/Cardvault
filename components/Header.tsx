"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

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

export default function Header() {
  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
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
          <Link href="/add" className="btn primary small">+ Add card</Link>
          <button className="btn ghost small" onClick={logout} title="Lock">Lock</button>
        </nav>
      </div>
    </header>
  );
}

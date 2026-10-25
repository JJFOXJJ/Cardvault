"use client";

import Link from "next/link";

export default function Header() {
  async function logout() {
    await fetch("/api/login", { method: "DELETE" });
    window.location.href = "/login";
  }
  return (
    <header className="top">
      <div className="wrap">
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

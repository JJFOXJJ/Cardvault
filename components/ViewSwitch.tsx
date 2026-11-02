import Link from "next/link";

/** Cards | Sets switch at the top of the two main screens. */
export default function ViewSwitch({ active }: { active: "cards" | "sets" }) {
  return (
    <nav className="seg view-switch" aria-label="View">
      <Link href="/" className={active === "cards" ? "on" : ""} aria-current={active === "cards" ? "page" : undefined}>Cards</Link>
      <Link href="/sets" className={active === "sets" ? "on" : ""} aria-current={active === "sets" ? "page" : undefined}>Sets</Link>
    </nav>
  );
}

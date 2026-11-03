/**
 * Two saved cards are "the same card" when category, collection, card number (or name when there's no number),
 * variant and grading all match. Used to stack them into one tile and to offer merging.
 */
type StackFields = {
  category?: string | null; set_name?: string | null; card_number?: string | null;
  name?: string | null; variant?: string | null; graded?: string | null;
};
const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/^#/, "").replace(/\s+/g, " ").trim();

export function stackKey(c: StackFields): string | null {
  const set = norm(c.set_name), num = norm(c.card_number), name = norm(c.name);
  if (!set && !num) return null; // too little to be sure two cards are the same
  if (!num && !name) return null;
  return [norm(c.category), set, num || `name:${name}`, norm(c.variant), norm(c.graded)].join("|");
}

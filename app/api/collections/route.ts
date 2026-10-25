import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db } from "@/lib/supabase";

type Count = { name: string; cards: number; value: number };

function tally(rows: Record<string, unknown>[], field: string): Count[] {
  const m = new Map<string, Count>();
  for (const r of rows) {
    const name = (r[field] as string | null)?.trim();
    if (!name) continue;
    const q = Number(r.quantity ?? 1);
    const c = m.get(name) ?? { name, cards: 0, value: 0 };
    c.cards += q;
    c.value += Number(r.aud_mid ?? 0) * q;
    m.set(name, c);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Names already used in the vault, with card counts — for dropdowns and the manage page. */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const { data, error } = await db().from("cards").select("set_name, manufacturer, category, quantity, aud_mid").neq("status", "pending");
  if (error) return jsonError(error.message, 500);
  const rows = data ?? [];
  return NextResponse.json({
    collections: tally(rows, "set_name"),
    manufacturers: tally(rows, "manufacturer"),
    categories: tally(rows, "category"),
    unsorted: rows.filter((r) => !(r.set_name as string | null)?.trim()).reduce((n, r) => n + Number(r.quantity ?? 1), 0),
  });
}

/**
 * Rename or merge collections.
 * Body: { from: string | null | (string | null)[], to: string }  — null means "Unsorted".
 * Renaming to a name that already exists merges them.
 */
export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { from?: string | null | (string | null)[]; to?: string } | null;
  const to = body?.to?.trim();
  if (!body || !to) return jsonError("Give the collection a name");
  if (to.length > 200) return jsonError("That name is too long");

  const froms = Array.isArray(body.from) ? body.from : [body.from ?? null];
  let updated = 0;
  for (const from of froms) {
    if (from === to) continue;
    let q = db().from("cards").update({ set_name: to, updated_at: new Date().toISOString() }).neq("status", "pending");
    q = from == null || from === "" ? q.is("set_name", null) : q.eq("set_name", from);
    const { data, error } = await q.select("id");
    if (error) return jsonError(error.message, 500);
    updated += data?.length ?? 0;
  }
  return NextResponse.json({ ok: true, updated });
}

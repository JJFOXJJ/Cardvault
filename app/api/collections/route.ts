import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db } from "@/lib/supabase";

/** List collection names with card counts. */
export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const { data, error } = await db().from("cards").select("set_name, quantity").neq("status", "pending");
  if (error) return jsonError(error.message, 500);
  const counts = new Map<string, number>();
  for (const r of data ?? []) {
    const name = (r.set_name as string | null)?.trim();
    if (name) counts.set(name, (counts.get(name) ?? 0) + (r.quantity ?? 1));
  }
  const collections = [...counts.entries()].map(([name, cards]) => ({ name, cards })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ collections });
}

/**
 * Rename a collection. If the new name already exists, the two are merged.
 * Body: { from: string | null (null = "Unsorted"), to: string }
 */
export async function PATCH(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { from?: string | null; to?: string } | null;
  const to = body?.to?.trim();
  if (!body || !to) return jsonError("Give the collection a name");
  if (to.length > 200) return jsonError("That name is too long");

  let q = db().from("cards").update({ set_name: to, updated_at: new Date().toISOString() }).neq("status", "pending");
  q = body.from == null || body.from === "" ? q.is("set_name", null) : q.eq("set_name", body.from);
  const { data, error } = await q.select("id");
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true, updated: data?.length ?? 0 });
}

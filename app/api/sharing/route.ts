import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { newToken } from "@/lib/sharing";

const missing = (m: string) => /share_links|profile_shares|relation|does not exist|schema cache/i.test(m);
const NEEDS = "Sharing needs a quick database update: run supabase/migrations/007_sharing.sql in Supabase → SQL Editor.";

/** My sharing settings, who I share with, and who shares with me. */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const [link, out, inc, all] = await Promise.all([
    db().from("share_links").select("token, show_values, created_at").eq("profile_id", me.id).maybeSingle(),
    db().from("profile_shares").select("viewer_id, show_values").eq("owner_id", me.id),
    db().from("profile_shares").select("owner_id").eq("viewer_id", me.id),
    db().from("profiles").select("id, name").order("name"),
  ]);
  if (link.error && missing(link.error.message)) return NextResponse.json({ needsMigration: true });
  const names = new Map((all.data ?? []).map((p) => [p.id, p.name as string]));
  return NextResponse.json({
    link: link.data ? { token: link.data.token, showValues: link.data.show_values, createdAt: link.data.created_at } : null,
    sharedWith: (out.data ?? []).map((r) => ({ id: r.viewer_id, name: names.get(r.viewer_id) ?? "?", showValues: r.show_values })),
    sharedWithMe: (inc.data ?? []).map((r) => ({ id: r.owner_id, name: names.get(r.owner_id) ?? "?" })),
    others: (all.data ?? []).filter((p) => p.id !== me.id).map((p) => ({ id: p.id, name: p.name })),
  });
}

type Body = { kind?: "link" | "person"; action?: string; profileId?: string; showValues?: boolean };

/** Change sharing. link: create | regenerate | values | off. person: add | values | remove. */
export async function POST(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.kind || !b.action) return jsonError("Nothing to change");

  let error: { message: string } | null = null;
  if (b.kind === "link") {
    if (b.action === "create" || b.action === "regenerate") {
      // A new token means any old link stops working straight away.
      ({ error } = await db().from("share_links").upsert(
        { profile_id: me.id, token: newToken(), show_values: b.showValues ?? true, created_at: new Date().toISOString() }, { onConflict: "profile_id" }));
    } else if (b.action === "values") {
      ({ error } = await db().from("share_links").update({ show_values: !!b.showValues }).eq("profile_id", me.id));
    } else if (b.action === "off") {
      ({ error } = await db().from("share_links").delete().eq("profile_id", me.id));
    } else return jsonError("Unknown action");
  } else if (b.kind === "person") {
    const id = b.profileId ?? "";
    if (!/^[0-9a-f-]{36}$/i.test(id) || id === me.id) return jsonError("Choose someone to share with");
    if (b.action === "add") {
      const { data: p } = await db().from("profiles").select("id").eq("id", id).maybeSingle();
      if (!p) return jsonError("That profile doesn't exist", 404);
      ({ error } = await db().from("profile_shares").upsert({ owner_id: me.id, viewer_id: id, show_values: b.showValues ?? true }, { onConflict: "owner_id,viewer_id" }));
    } else if (b.action === "values") {
      ({ error } = await db().from("profile_shares").update({ show_values: !!b.showValues }).eq("owner_id", me.id).eq("viewer_id", id));
    } else if (b.action === "remove") {
      ({ error } = await db().from("profile_shares").delete().eq("owner_id", me.id).eq("viewer_id", id));
    } else return jsonError("Unknown action");
  } else return jsonError("Unknown change");

  if (error) return jsonError(missing(error.message) ? NEEDS : error.message, missing(error.message) ? 400 : 500);
  return NextResponse.json({ ok: true });
}

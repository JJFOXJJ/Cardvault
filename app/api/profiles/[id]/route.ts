import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin, requireProfile, setSessionCookie } from "@/lib/auth";
import { checkPin, hashPin, isValidPin, PIN_RULE } from "@/lib/pin";
import { BUCKET, db } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Update a profile.
 * - Anyone can change their own name, or their own PIN (with their current PIN).
 * - Admins can rename anyone, reset anyone's PIN, and grant/remove admin.
 * Changing a PIN signs that profile out on every other device.
 */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const { id } = await params;
  const self = id === me.id;
  if (!self && !me.is_admin) return jsonError("You can only change your own profile.", 403);

  const body = (await req.json().catch(() => null)) as { name?: string; pin?: string; currentPin?: string; is_admin?: boolean } | null;
  if (!body) return jsonError("Nothing to change");

  const { data: target } = await db().from("profiles").select("id, pin_hash, is_admin, session_version").eq("id", id).maybeSingle();
  if (!target) return jsonError("Profile not found", 404);

  const update: Record<string, unknown> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 40) return jsonError("Enter a name (up to 40 characters).");
    update.name = name;
  }

  if (body.pin !== undefined) {
    if (!isValidPin(body.pin)) return jsonError(PIN_RULE);
    // Changing your own PIN needs your current one (stops someone using an unlocked phone).
    if (self && !(typeof body.currentPin === "string" && (await checkPin(body.currentPin, target.pin_hash)))) {
      return jsonError("Your current PIN is wrong.", 403);
    }
    update.pin_hash = await hashPin(body.pin);
    update.session_version = target.session_version + 1;
  }

  if (body.is_admin !== undefined) {
    if (!me.is_admin) return jsonError("Only an admin can do that", 403);
    if (target.is_admin && !body.is_admin) {
      const { count } = await db().from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", true);
      if ((count ?? 0) <= 1) return jsonError("There must be at least one admin.");
    }
    update.is_admin = !!body.is_admin;
  }

  if (!Object.keys(update).length) return jsonError("Nothing to change");
  const { error } = await db().from("profiles").update(update).eq("id", id);
  if (error) return jsonError(/duplicate|unique/i.test(error.message) ? "There's already a profile with that name." : error.message, 400);

  const res = NextResponse.json({ ok: true });
  // Keep THIS device signed in after changing your own PIN.
  if (self && update.session_version) await setSessionCookie(res, { id, session_version: update.session_version as number });
  return res;
}

/** Admin: delete another profile, its cards and its pictures. Requires typing the profile's name. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const { id } = await params;
  if (id === me.id) return jsonError("You can't delete your own profile.");

  const body = (await req.json().catch(() => null)) as { confirmName?: string } | null;
  const { data: target } = await db().from("profiles").select("id, name").eq("id", id).maybeSingle();
  if (!target) return jsonError("Profile not found", 404);
  if (body?.confirmName?.trim().toLowerCase() !== target.name.toLowerCase()) return jsonError(`Type "${target.name}" to confirm.`);

  // Remove their stored pictures first (the database rows go with the profile).
  const { data: rows } = await db().from("cards").select("image_url, photo_url, back_photo_url").eq("profile_id", id);
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const paths = [...new Set((rows ?? []).flatMap((r) => [r.image_url, r.photo_url, r.back_photo_url]))]
    .filter((u): u is string => typeof u === "string" && u.includes(marker))
    .map((u) => u.slice(u.indexOf(marker) + marker.length));
  for (let i = 0; i < paths.length; i += 100) await db().storage.from(BUCKET).remove(paths.slice(i, i + 100));

  const { error } = await db().from("profiles").delete().eq("id", id); // cards cascade
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true, removedCards: rows?.length ?? 0 });
}

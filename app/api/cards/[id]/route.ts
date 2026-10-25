import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db, pickEditable, removeStoredImage, storeImage } from "@/lib/supabase";

export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as (Record<string, unknown> & { imageUrl?: string; imageSource?: string; useOwnPhoto?: boolean }) | null;
  if (!body) return jsonError("Nothing to update");

  const { data: current } = await db().from("cards").select("image_url, photo_url").eq("id", id).single();
  if (!current) return jsonError("Card not found", 404);

  const update: Record<string, unknown> = { ...pickEditable(body), updated_at: new Date().toISOString() };

  try {
    if (body.useOwnPhoto && current.photo_url) {
      if (current.image_url !== current.photo_url) await removeStoredImage(current.image_url);
      update.image_url = current.photo_url;
      update.image_source = null;
    } else if (body.imageUrl) {
      update.image_url = await storeImage(body.imageUrl, "official");
      update.image_source = body.imageSource ?? null;
      if (current.image_url !== current.photo_url) await removeStoredImage(current.image_url);
    }
  } catch (e) {
    return jsonError(`Couldn't save that picture (${e instanceof Error ? e.message : "error"}). Pick another one.`, 422);
  }

  const { error } = await db().from("cards").update(update).eq("id", id);
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;
  const { data: card } = await db().from("cards").select("image_url, photo_url, back_photo_url").eq("id", id).single();
  const { error } = await db().from("cards").delete().eq("id", id);
  if (error) return jsonError(error.message, 500);
  await removeStoredImage(card?.image_url ?? null);
  if (card?.photo_url !== card?.image_url) await removeStoredImage(card?.photo_url ?? null);
  await removeStoredImage(card?.back_photo_url ?? null);
  return NextResponse.json({ ok: true });
}

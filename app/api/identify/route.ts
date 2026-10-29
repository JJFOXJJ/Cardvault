import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, jsonError } from "@/lib/auth";
import { runIdentify } from "@/lib/identify";
import { photosAsBase64, cardsOf } from "@/lib/supabase";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);

  const body = (await req.json().catch(() => null)) as { images?: string[]; hint?: string; pendingId?: string } | null;

  try {
    let images: { mediaType: string; data: string }[];
    let hint = body?.hint;

    if (body?.pendingId) {
      // A card saved earlier: use its stored photos.
      const { data: row } = await mine.select("photo_url, back_photo_url, hint").eq("id", body.pendingId).single();
      if (!row?.photo_url) return jsonError("That saved card has no photo", 404);
      images = await photosAsBase64([row.photo_url, row.back_photo_url]);
      hint = hint?.trim() ? hint : row.hint ?? undefined;
    } else {
      images = (body?.images ?? [])
        .slice(0, 2)
        .map((d) => d.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/))
        .filter((m): m is RegExpMatchArray => Boolean(m))
        .map((m) => ({ mediaType: m[1], data: m[2] }));
    }
    if (!images.length) return jsonError("Add a photo of the card first");

    return NextResponse.json(await runIdentify(me.id, images, hint));
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Lookup failed", 502);
  }
}

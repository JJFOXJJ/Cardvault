import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db, pickEditable, storeImage } from "@/lib/supabase";

export const maxDuration = 60;

type Body = Record<string, unknown> & {
  imageUrl?: string;       // chosen online image
  imageSource?: string;
  photo?: string;          // the owner's photo (data URL)
  useOwnPhoto?: boolean;   // no good online image — show the photo instead
};

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) return jsonError("The card needs a name");

  try {
    const photo_url = body.photo ? await storeImage(body.photo, "photos") : null;

    let image_url: string | null = null;
    if (body.imageUrl && !body.useOwnPhoto) {
      try {
        image_url = await storeImage(body.imageUrl, "official");
      } catch (e) {
        return jsonError(`Couldn't save that picture (${e instanceof Error ? e.message : "error"}). Pick another one.`, 422);
      }
    }

    const { data, error } = await db()
      .from("cards")
      .insert({
        ...pickEditable(body),
        image_url: image_url ?? photo_url,
        image_source: image_url ? body.imageSource ?? null : null,
        photo_url,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ id: data.id });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Save failed", 500);
  }
}

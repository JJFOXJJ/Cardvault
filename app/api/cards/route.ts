import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, jsonError } from "@/lib/auth";
import { canonicalSetName } from "@/lib/catalog";
import { pickEditable, storeImage, cardsOf } from "@/lib/supabase";
import { keepPicture } from "@/lib/shared";

export const maxDuration = 60;

/** Fetch a few cards by id (for the "Just added" strip). GET /api/cards?ids=a,b,c */
export async function GET(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 200);
  if (!ids.length) return NextResponse.json({ cards: [] });
  const { data, error } = await mine
    .select("id, name, set_name, image_url, photo_url, aud_mid, quantity, confidence, status")
    .in("id", ids);
  if (error) return jsonError(error.message, 500);
  // Keep the caller's order (newest first).
  const byId = new Map((data ?? []).map((c) => [c.id, c]));
  return NextResponse.json({ cards: ids.map((id) => byId.get(id)).filter(Boolean) });
}

type Body = Record<string, unknown> & {
  imageUrl?: string;       // chosen online image
  imageSource?: string;
  photo?: string;          // the owner's photo (data URL)
  useOwnPhoto?: boolean;   // no good online image — show the photo instead
};

export async function POST(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);

  const body = (await req.json().catch(() => null)) as Body | null;
  if (!body || typeof body.name !== "string" || !body.name.trim()) return jsonError("The card needs a name");

  try {
    const photo_url = body.photo ? await storeImage(body.photo, "photos") : null;

    let image_url: string | null = null;
    if (body.imageUrl && !body.useOwnPhoto) {
      try {
        const f = pickEditable(body) as Record<string, string | null>;
        image_url = await keepPicture(body.imageUrl, f, body.imageSource);
      } catch (e) {
        return jsonError(`Couldn't save that picture (${e instanceof Error ? e.message : "error"}). Pick another one.`, 422);
      }
    }

    const fields = pickEditable(body);
    if (typeof fields.set_name === "string") fields.set_name = (await canonicalSetName(fields.set_name).catch(() => null)) ?? fields.set_name;
    const { data, error } = await mine
      .insert({
        ...fields,
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

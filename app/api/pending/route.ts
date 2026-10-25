import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db, storeImage } from "@/lib/supabase";

export const maxDuration = 60;

/** Save photos now, identify later. One card per request. */
export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { front?: string; back?: string; hint?: string } | null;
  if (!body?.front?.startsWith("data:image/")) return jsonError("Add a photo of the card first");

  try {
    const photo_url = await storeImage(body.front, "photos");
    const back_photo_url = body.back?.startsWith("data:image/") ? await storeImage(body.back, "photos") : null;

    const { data, error } = await db()
      .from("cards")
      .insert({
        status: "pending",
        name: "Waiting to identify",
        photo_url,
        back_photo_url,
        image_url: photo_url,
        hint: body.hint?.trim() || null,
      })
      .select("id")
      .single();
    if (error) {
      if (/status|back_photo_url|hint|column/i.test(error.message)) {
        throw new Error("The database needs a quick update: run supabase/migrations/002_waiting_list.sql in the Supabase SQL Editor.");
      }
      throw new Error(error.message);
    }

    const { count } = await db().from("cards").select("id", { count: "exact", head: true }).eq("status", "pending");
    return NextResponse.json({ id: data.id, waiting: count ?? null });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Couldn't save the photo", 500);
  }
}

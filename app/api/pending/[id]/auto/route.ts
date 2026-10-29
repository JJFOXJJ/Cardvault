import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, jsonError } from "@/lib/auth";
import { runIdentify } from "@/lib/identify";
import { photosAsBase64, storeImage, cardsOf } from "@/lib/supabase";
import { round } from "@/lib/fx";

export const maxDuration = 150;

/** Identify a waiting card and file it automatically, using the top picture found. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);
  const { id } = await params;

  const { data: row } = await mine.select("*").eq("id", id).single();
  if (!row) return jsonError("Card not found", 404);
  if (row.status !== "pending") return NextResponse.json({ ok: true, skipped: true });

  try {
    const r = await runIdentify(me.id, await photosAsBase64([row.photo_url, row.back_photo_url]), row.hint);

    // Store the first picture that downloads cleanly; otherwise keep the owner's photo.
    let image_url: string = row.photo_url;
    let image_source: string | null = null;
    for (const c of r.candidates.slice(0, 3)) {
      try {
        image_url = await storeImage(c.url, "official");
        image_source = c.source ?? null;
        break;
      } catch {
        /* try the next one */
      }
    }

    const c = r.card;
    const v = c.value_usd;
    const update = {
      status: "catalogued",
      category: c.category,
      name: c.name,
      subject: c.subject,
      year: c.year,
      manufacturer: c.manufacturer,
      set_name: c.set_name,
      card_number: c.card_number,
      variant: c.variant,
      graded: c.graded,
      confidence: c.confidence,
      value_usd_mid: v ? round(v.mid) : null,
      aud_low: r.aud?.low ?? null,
      aud_mid: r.aud?.mid ?? null,
      aud_high: r.aud?.high ?? null,
      fx_usd_aud: r.fx,
      value_notes: c.value_notes,
      price_sources: c.price_sources,
      priced_at: new Date().toISOString(),
      image_url,
      image_source,
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await mine.update(update).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, name: c.name, confidence: c.confidence, aud_mid: update.aud_mid });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Identification failed";
    await mine.update({ last_error: message.slice(0, 300) }).eq("id", id);
    return jsonError(message, 502);
  }
}

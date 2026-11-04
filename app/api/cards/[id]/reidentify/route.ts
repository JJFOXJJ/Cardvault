import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireProfile } from "@/lib/auth";
import { runIdentify } from "@/lib/identify";
import { cardsOf, photosAsBase64, removeStoredImage, setsOf, storeImage } from "@/lib/supabase";
import { keepPicture } from "@/lib/shared";
import { getSet, linkExistingCards } from "@/lib/checklist";
import { round } from "@/lib/fx";

export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };
const dataUrl = (s: unknown): s is string => typeof s === "string" && /^data:image\/(jpeg|png|webp|gif);base64,/.test(s);
const toImage = (d: string) => { const m = d.match(/^data:(image\/[a-z]+);base64,(.+)$/)!; return { mediaType: m[1], data: m[2] }; };

/**
 * Re-identify a card.
 *  { step: "identify", front?, back?, hint? } → the new identification (nothing is saved)
 *  { step: "apply", front?, back?, result, picture?, updateValue } → saves what the owner approved
 * New photos replace the stored ones only when applied. Quantity, condition, notes stay as they are.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);
  const { id } = await params;
  const { data: card } = await mine.select("*").eq("id", id).single();
  if (!card) return jsonError("Card not found", 404);

  type Body = {
    step?: "identify" | "apply"; front?: string; back?: string; hint?: string;
    result?: Record<string, unknown> & { aud?: { low: number | null; mid: number | null; high: number | null } | null; fx?: number };
    picture?: { url: string; source?: string | null } | "keep" | "own";
    updateValue?: boolean;
  };
  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.step) return jsonError("Nothing to do");
  if (b.front && !dataUrl(b.front)) return jsonError("The front photo isn't an image");
  if (b.back && !dataUrl(b.back)) return jsonError("The back photo isn't an image");

  if (b.step === "identify") {
    try {
      // New photos if given; otherwise the ones saved with the card.
      const saved = async (u: string | null) => (u ? (await photosAsBase64([u]))[0] ?? null : null);
      const front = b.front ? toImage(b.front) : await saved(card.photo_url);
      const back = b.back ? toImage(b.back) : await saved(card.back_photo_url);
      const images = (front ? [front, back] : []).filter(Boolean) as { mediaType: string; data: string }[]; // the front must come first
      if (!images.length) return jsonError("This card has no saved photo — add a photo of the front.");
      return NextResponse.json(await runIdentify(me.id, images, b.hint?.trim() || card.hint));
    } catch (e) {
      return jsonError(e instanceof Error ? e.message : "Identification failed", 502);
    }
  }

  // ---- apply
  const r = b.result;
  if (!r || typeof r.name !== "string") return jsonError("Nothing to apply");
  const str = (k: string) => (typeof r[k] === "string" && (r[k] as string).trim() ? (r[k] as string).trim() : null);
  const update: Record<string, unknown> = {
    category: str("category") ?? card.category, name: str("name") ?? card.name, subject: str("subject"), year: str("year"),
    manufacturer: str("manufacturer"), set_name: str("set_name"), card_number: str("card_number"), variant: str("variant"),
    graded: str("graded"), confidence: str("confidence"), last_error: null, updated_at: new Date().toISOString(),
  };
  if (b.updateValue) {
    const v = r.value_usd as { mid?: number } | null;
    Object.assign(update, {
      value_usd_mid: v?.mid != null ? round(v.mid) : null, aud_low: r.aud?.low ?? null, aud_mid: r.aud?.mid ?? null, aud_high: r.aud?.high ?? null,
      fx_usd_aud: r.fx ?? null, value_notes: str("value_notes"), price_sources: Array.isArray(r.price_sources) ? r.price_sources : [], priced_at: new Date().toISOString(),
    });
  }
  try {
    // New photos replace the old ones.
    const old: (string | null)[] = [];
    if (b.front) { update.photo_url = await storeImage(b.front, "photos"); old.push(card.photo_url); }
    if (b.back) { update.back_photo_url = await storeImage(b.back, "photos"); old.push(card.back_photo_url); }
    const usingOwn = card.image_url && card.image_url === card.photo_url;
    if (b.picture && b.picture !== "keep") {
      if (b.picture === "own") update.image_url = update.photo_url ?? card.photo_url;
      else { update.image_url = await keepPicture(b.picture.url, { ...update, confidence: str("confidence") } as never, b.picture.source); update.image_source = b.picture.source ?? null; }
      if (card.image_url !== card.photo_url) old.push(card.image_url);
    } else if (usingOwn && update.photo_url) update.image_url = update.photo_url; // shown picture was your photo → show the new one

    // A different player, set or number means the old checklist link may be wrong: re-match it.
    const moved = update.set_name !== card.set_name || update.card_number !== card.card_number || update.subject !== card.subject;
    if (moved) update.checklist_id = null;
    const { error } = await mine.update(update).eq("id", id);
    if (error) throw new Error(error.message);
    for (const u of old) if (u && u !== update.image_url) await removeStoredImage(u).catch(() => {});

    if (moved && update.set_name) {
      const { data: s } = await setsOf(me.id).select("id").ilike("name", String(update.set_name).replace(/[%_]/g, "\\$&")).eq("tracking", true).maybeSingle();
      const set = s ? await getSet(me.id, s.id) : null;
      if (set?.total) await linkExistingCards(me.id, set);
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Couldn't save", 500);
  }
}

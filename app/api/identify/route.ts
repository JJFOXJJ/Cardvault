import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { identifyCard } from "@/lib/ai";
import { braveImages, pokemonImages, type ImageCandidate } from "@/lib/images";
import { usdToAud, round } from "@/lib/fx";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;

  const body = (await req.json().catch(() => null)) as { images?: string[]; hint?: string } | null;
  const images = (body?.images ?? [])
    .slice(0, 2)
    .map((d) => d.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ mediaType: m[1], data: m[2] }));
  if (!images.length) return jsonError("Add a photo of the card first");

  try {
    const card = await identifyCard(images, body?.hint);

    let candidates: ImageCandidate[] = [];
    let value = card.value_usd;

    if (card.is_pokemon && card.subject) {
      const matches = await pokemonImages(card.subject, card.card_number, card.set_name);
      candidates = matches;
      // Prefer TCGplayer's market price for an exact Pokémon match when the AI found nothing.
      const exact = matches[0];
      if (!value && exact?.marketUsd) {
        value = { low: exact.marketUsd * 0.8, mid: exact.marketUsd, high: exact.marketUsd * 1.25 };
      }
    }
    if (candidates.length < 4) {
      candidates = [...candidates, ...(await braveImages(card.image_query, 8 - candidates.length))];
    }

    const fx = await usdToAud();
    return NextResponse.json({
      card: { ...card, value_usd: value },
      aud: value ? { low: round(value.low * fx), mid: round(value.mid * fx), high: round(value.high * fx) } : null,
      fx,
      candidates,
      imageSearchEnabled: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    });
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Lookup failed", 502);
  }
}

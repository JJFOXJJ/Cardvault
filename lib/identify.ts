import { identifyCard, type Identification } from "./ai";
import { braveImages, pokemonImages, type ImageCandidate } from "./images";
import { round, usdToAud } from "./fx";
import { cardsOf } from "./supabase";
import { braveAllowed } from "./usage";

export type IdentifyResult = {
  card: Identification;
  aud: { low: number | null; mid: number | null; high: number | null } | null;
  fx: number;
  candidates: ImageCandidate[];
  imageSearchEnabled: boolean;
  searchCapped: boolean;
};

/** Identify a card from photos, estimate its value and find clean pictures of it. */
export async function runIdentify(profileId: string, images: { mediaType: string; data: string }[], hint?: string | null): Promise<IdentifyResult> {
  const searchCapped = !!process.env.BRAVE_SEARCH_API_KEY && !(await braveAllowed());
  const card = await identifyCard(images, hint ?? undefined, await existingSetNames(profileId), profileId);

  let candidates: ImageCandidate[] = [];
  let value = card.value_usd;

  if (card.is_pokemon && card.subject) {
    const matches = await pokemonImages(card.subject, card.card_number, card.set_name).catch(() => []);
    candidates = matches;
    // Prefer TCGplayer's market price for an exact Pokémon match when the AI found nothing.
    const exact = matches[0];
    if (!value && exact?.marketUsd) {
      value = { low: exact.marketUsd * 0.8, mid: exact.marketUsd, high: exact.marketUsd * 1.25 };
    }
  }
  if (candidates.length < 4) {
    candidates = [...candidates, ...(await braveImages(card.image_query, 8 - candidates.length, profileId).catch(() => []))];
  }

  const fx = await usdToAud();
  return {
    card: { ...card, value_usd: value },
    aud: value ? { low: round(value.low * fx), mid: round(value.mid * fx), high: round(value.high * fx) } : null,
    fx,
    candidates,
    imageSearchEnabled: Boolean(process.env.BRAVE_SEARCH_API_KEY),
    searchCapped,
  };
}

/** Distinct collection names already in the vault (catalogued cards only). */
export async function existingSetNames(profileId: string): Promise<string[]> {
  const { data } = await cardsOf(profileId).select("set_name").neq("status", "pending").not("set_name", "is", null);
  return [...new Set((data ?? []).map((r) => (r.set_name as string).trim()).filter(Boolean))].sort();
}

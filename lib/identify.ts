import { identifyCard, type Identification } from "./ai";
import { pokemonImages, type ImageCandidate } from "./images";
import { round, usdToAud } from "./fx";
import { cardsOf } from "./supabase";
import { imageSearch, searchAllowed, searchConfigured } from "./search";
import { countSaved, pictureKey, sharedPicture, sharedSet } from "./shared";
import { isInsertCard, samePerson } from "./checklist";
import { approvedNames, canonicalSetName } from "./catalog";

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
  const searchCapped = searchConfigured() && !(await searchAllowed());
  // The AI chooses from your collections plus the approved set list, so new duplicates aren't created.
  const known = [...new Set([...(await approvedNames().catch(() => [])), ...(await existingSetNames(profileId))])];
  const card = await identifyCard(images, hint ?? undefined, known, profileId);
  // Another spelling of an approved set → the approved name.
  const approved = await canonicalSetName(card.set_name).catch(() => null);
  if (approved) card.set_name = approved;

  // The number is usually only on the back. If it wasn't visible, take it from the set's checklist
  // in the shared library — but only when that player has exactly one card in the set.
  if (!card.card_number && card.set_name && card.subject && !isInsertCard(card)) {
    const list = await sharedSet(card.set_name).catch(() => null);
    const hits = (list?.entries ?? []).filter((e) => samePerson(card.subject, e.name));
    if (hits.length === 1 && hits[0].number) {
      card.card_number = hits[0].number;
      card.name = `${card.subject} #${hits[0].number}`;
    }
  }

  let candidates: ImageCandidate[] = [];
  let value = card.value_usd;

  // Someone already found a clean picture of this exact card: offer it first, no search needed.
  const shared = await sharedPicture(pictureKey(card)).catch(() => null);
  if (shared) candidates.push({ url: shared, thumb: shared, origin: "shared", title: "From the shared library" });

  if (card.is_pokemon && card.subject) {
    const matches = await pokemonImages(card.subject, card.card_number, card.set_name).catch(() => []);
    candidates.push(...matches.filter((m) => m.url !== shared));
    // Prefer TCGplayer's market price for an exact Pokémon match when the AI found nothing.
    const exact = matches[0];
    if (!value && exact?.marketUsd) {
      value = { low: exact.marketUsd * 0.8, mid: exact.marketUsd, high: exact.marketUsd * 1.25 };
    }
  }
  // Pictures that came back with the price search (Tavily) are free.
  const seen = new Set(candidates.map((c) => c.url));
  for (const im of card.found_images) if (!seen.has(im.url)) { candidates.push(im); seen.add(im.url); }

  if (shared || candidates.filter((c) => c.origin !== "web").length >= 1 || candidates.length >= 3) {
    if (shared) await countSaved(profileId); // skipped the picture search
  } else {
    candidates = [...candidates, ...(await imageSearch(card.image_query, 8 - candidates.length, profileId).catch(() => []))];
  }

  const fx = await usdToAud();
  return {
    card: { ...card, value_usd: value },
    aud: value ? { low: round(value.low * fx), mid: round(value.mid * fx), high: round(value.high * fx) } : null,
    fx,
    candidates,
    imageSearchEnabled: searchConfigured(),
    searchCapped,
  };
}

/** Distinct collection names already in the vault (catalogued cards only). */
export async function existingSetNames(profileId: string): Promise<string[]> {
  const { data } = await cardsOf(profileId).select("set_name").neq("status", "pending").not("set_name", "is", null);
  return [...new Set((data ?? []).map((r) => (r.set_name as string).trim()).filter(Boolean))].sort();
}

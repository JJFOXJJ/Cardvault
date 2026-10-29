import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service-role key. */
export function db(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

export const BUCKET = "card-images";

export type Card = {
  id: string;
  created_at: string;
  updated_at: string;
  category: string;
  name: string;
  subject: string | null;
  year: string | null;
  manufacturer: string | null;
  set_name: string | null;
  card_number: string | null;
  variant: string | null;
  graded: string | null;
  condition: string | null;
  quantity: number;
  notes: string | null;
  image_url: string | null;
  image_source: string | null;
  photo_url: string | null;
  value_usd_mid: number | null;
  aud_low: number | null;
  aud_mid: number | null;
  aud_high: number | null;
  fx_usd_aud: number | null;
  value_notes: string | null;
  price_sources: { title: string; url: string }[];
  priced_at: string | null;
  confidence: string | null;
  status: "pending" | "catalogued";
  back_photo_url: string | null;
  hint: string | null;
  last_error: string | null;
  profile_id: string;
};

/** Fields the client is allowed to set when creating or editing a card. */
export const EDITABLE_FIELDS = [
  "category", "name", "subject", "year", "manufacturer", "set_name", "card_number",
  "variant", "graded", "condition", "quantity", "notes",
  "value_usd_mid", "aud_low", "aud_mid", "aud_high", "fx_usd_aud",
  "value_notes", "price_sources", "priced_at", "confidence", "status", "hint", "last_error",
] as const;

export function pickEditable(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE_FIELDS) if (k in input) out[k] = input[k];
  if ("quantity" in out) out.quantity = Math.max(1, Math.floor(Number(out.quantity) || 1));
  if ("status" in out && out.status !== "pending" && out.status !== "catalogued") delete out.status;
  return out;
}

/** Download a remote image or decode a data URL, then store it in the bucket. Returns the public URL. */
export async function storeImage(src: string, folder: "official" | "photos"): Promise<string> {
  let bytes: ArrayBuffer;
  let type: string;

  if (src.startsWith("data:")) {
    const m = src.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
    if (!m) throw new Error("Unsupported image data");
    type = m[1];
    bytes = Uint8Array.from(Buffer.from(m[2], "base64")).buffer;
  } else {
    const url = new URL(src);
    if (url.protocol !== "https:") throw new Error("Only https image URLs are allowed");
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (CardVault image fetch)", Accept: "image/*" },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Image download failed (${res.status})`);
    type = (res.headers.get("content-type") || "").split(";")[0].trim();
    if (!type.startsWith("image/")) throw new Error("That link is not an image");
    bytes = await res.arrayBuffer();
  }

  if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Image is larger than 10 MB");
  const ext = ({ "image/png": "png", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" } as Record<string, string>)[type] ?? "jpg";
  const path = `${folder}/${crypto.randomUUID()}.${ext}`;

  const { error } = await db().storage.from(BUCKET).upload(path, bytes, { contentType: type, upsert: false });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return db().storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Remove a stored image if it lives in our bucket. */
export async function removeStoredImage(publicUrl: string | null) {
  if (!publicUrl) return;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = publicUrl.indexOf(marker);
  if (i === -1) return;
  await db().storage.from(BUCKET).remove([publicUrl.slice(i + marker.length)]);
}

/** Load stored photos back as base64 for the AI. */
export async function photosAsBase64(urls: (string | null)[]) {
  const out: { mediaType: string; data: string }[] = [];
  for (const url of urls) {
    if (!url) continue;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Couldn't load the saved photo (${res.status})`);
    const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    out.push({ mediaType: type.startsWith("image/") ? type : "image/jpeg", data: Buffer.from(await res.arrayBuffer()).toString("base64") });
  }
  return out;
}

/**
 * The ONLY way the app touches the cards table: every query is locked to one profile,
 * and inserts are stamped with it. Using db().from("cards") directly anywhere else is a bug.
 */
export function cardsOf(profileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(profileId)) throw new Error("Invalid profile");
  const t = () => db().from("cards");
  return {
    // Typed as "*" so rows come back loosely typed; the real column list is still sent.
    select: (columns: string = "*", options?: { count?: "exact"; head?: boolean }) =>
      t().select(columns as "*", options).eq("profile_id", profileId),
    insert: (row: Record<string, unknown>) => t().insert({ ...row, profile_id: profileId }),
    update: (values: Record<string, unknown>) => {
      const { profile_id: _ignored, ...safe } = values;
      return t().update(safe).eq("profile_id", profileId);
    },
    delete: () => t().delete().eq("profile_id", profileId),
  };
}

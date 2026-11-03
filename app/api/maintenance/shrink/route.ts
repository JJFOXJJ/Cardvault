import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { BUCKET, cardsOf, db, shrink } from "@/lib/supabase";

export const maxDuration = 60;

const marker = `/storage/v1/object/public/${BUCKET}/`;
const isOurs = (u: string | null) => !!u && u.includes(marker);
// Shared-library pictures are already small and belong to everyone, so they're left alone.
const needsShrink = (u: string | null) => isOurs(u) && !u!.endsWith(".webp") && !u!.includes(`${marker}shared/`);

/**
 * Shrink pictures saved before resizing existed (your profile only), a few at a time.
 * Returns how many are left so the page can keep calling.
 */
export async function POST() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;

  const { data: cards } = await cardsOf(me.id).select("id, image_url, photo_url, back_photo_url");
  const todo = (cards ?? []).filter((c) => needsShrink(c.image_url) || needsShrink(c.photo_url) || needsShrink(c.back_photo_url));
  let done = 0, savedBytes = 0;
  const started = Date.now();

  for (const c of todo) {
    if (Date.now() - started > 40_000) break; // keep each request short
    const update: Record<string, string> = {};
    const replaced = new Map<string, string>();
    for (const field of ["photo_url", "image_url", "back_photo_url"] as const) {
      const url = c[field] as string | null;
      if (!needsShrink(url)) continue;
      if (replaced.has(url!)) { update[field] = replaced.get(url!)!; continue; } // image_url often == photo_url
      const oldPath = url!.slice(url!.indexOf(marker) + marker.length);
      try {
        const res = await fetch(url!, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) continue;
        const type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
        const before = await res.arrayBuffer();
        const out = await shrink(before, type, oldPath.startsWith("photos/") ? 1200 : 800);
        if (out.type !== "image/webp") continue;
        const newPath = `${oldPath.split("/")[0]}/${crypto.randomUUID()}.webp`;
        const { error } = await db().storage.from(BUCKET).upload(newPath, out.bytes, { contentType: "image/webp" });
        if (error) continue;
        const newUrl = db().storage.from(BUCKET).getPublicUrl(newPath).data.publicUrl;
        replaced.set(url!, newUrl);
        update[field] = newUrl;
        savedBytes += before.byteLength - out.bytes.byteLength;
      } catch { /* leave this one as it is */ }
    }
    if (Object.keys(update).length) {
      const { error } = await cardsOf(me.id).update(update).eq("id", c.id);
      if (!error) {
        // Old copies are only removed once the card points at the new ones.
        await db().storage.from(BUCKET).remove([...replaced.keys()].map((u) => u.slice(u.indexOf(marker) + marker.length)));
      }
    }
    done++;
  }
  return NextResponse.json({ done, remaining: Math.max(0, todo.length - done), savedMB: Math.round((savedBytes / 1048576) * 10) / 10 });
}

"use client";

/** Shrink a camera photo to a JPEG data URL — keeps uploads small and AI costs low. */
export async function fileToDataUrl(file: File, maxSide = 1600, quality = 0.85): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export const aud = (n: number | null | undefined, cents = true) =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        minimumFractionDigits: cents && n < 100 ? 2 : 0,
        maximumFractionDigits: cents && n < 100 ? 2 : 0,
      }).format(n);

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401 && !url.includes("/api/login")) {
    window.location.href = "/login";
    throw new Error("Signed out");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `Request failed (${res.status})`);
  return data as T;
}

export const CATEGORIES = ["Marvel", "Basketball", "The Simpsons", "Pokémon", "Other"];
export const CONDITIONS = ["Mint", "Near Mint", "Excellent", "Very Good", "Good", "Fair", "Poor"];

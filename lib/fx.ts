/** USD → AUD rate from Frankfurter (ECB reference rates, free, no key). Cached for 12 hours. */
export async function usdToAud(): Promise<number> {
  try {
    const res = await fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD", {
      next: { revalidate: 43200 },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: { AUD?: number } };
      if (data.rates?.AUD) return data.rates.AUD;
    }
  } catch {
    /* fall through */
  }
  return Number(process.env.FALLBACK_USD_AUD) || 1.52;
}

/** Turn a USD range into the AUD columns stored on a card. */
export async function valueColumns(v: { low: number; mid: number; high: number } | null) {
  const fx = await usdToAud();
  return {
    value_usd_mid: v ? round(v.mid) : null,
    aud_low: v ? round(v.low * fx) : null,
    aud_mid: v ? round(v.mid * fx) : null,
    aud_high: v ? round(v.high * fx) : null,
    fx_usd_aud: fx,
    priced_at: new Date().toISOString(),
  };
}

export const round =(n: number | null | undefined) =>
  n == null || !isFinite(n) ? null : Math.round(n * 100) / 100;

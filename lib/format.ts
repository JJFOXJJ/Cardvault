/** AUD for server-rendered pages (lib/client's `aud` is browser-only). */
export const audS = (n: number | null | undefined, cents = true) =>
  n == null ? "—" : n.toLocaleString("en-AU", { style: "currency", currency: "AUD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

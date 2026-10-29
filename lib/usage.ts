import { db } from "./supabase";

// Brave's free credit is $5/month at $5 per 1,000 requests → 1,000 requests.
// Override with BRAVE_MONTHLY_LIMIT in Vercel if your plan differs.
export const braveLimit = () => Math.max(0, Number(process.env.BRAVE_MONTHLY_LIMIT) || 1000);
export const SEARCHES_PER_SCAN = 2; // one web search for prices + one image search

export type Service = "brave" | "gemini";

/** Brave counts by calendar month (UTC). */
export function bravePeriod(d = new Date()) {
  return d.toISOString().slice(0, 7);
}
export function nextBraveReset(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
}

/** Gemini's free daily limits reset at midnight US Pacific time. */
function pacificParts(d: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return p as Record<string, string>;
}
export function geminiPeriod(d = new Date()) {
  const p = pacificParts(d);
  return `${p.year}-${p.month}-${p.day}`;
}
export function nextGeminiReset(d = new Date()) {
  const p = pacificParts(d);
  const msIntoDay = ((Number(p.hour) * 60 + Number(p.minute)) * 60 + Number(p.second)) * 1000;
  return new Date(d.getTime() - msIntoDay - d.getMilliseconds() + 86_400_000).toISOString();
}

const periodFor = (s: Service) => (s === "brave" ? bravePeriod() : geminiPeriod());

/** Add to a profile's count. Never breaks a scan if counting fails (e.g. migration not run yet). */
export async function recordUsage(service: Service, profileId: string | undefined, n = 1) {
  if (!profileId) return;
  try {
    const { error } = await db().rpc("bump_usage", { p_period: periodFor(service), p_service: service, p_profile: profileId, p_n: n });
    if (error) console.warn("usage not recorded:", error.message);
  } catch (e) {
    console.warn("usage not recorded:", e);
  }
}

async function totalFor(service: Service): Promise<number | null> {
  const { data, error } = await db().from("api_usage").select("count").eq("period", periodFor(service)).eq("service", service);
  if (error) return null;
  return (data ?? []).reduce((n, r) => n + (r.count ?? 0), 0);
}

/** True while this month's Brave searches are under the limit. Fails open if usage can't be read. */
export async function braveAllowed(): Promise<boolean> {
  const used = await totalFor("brave").catch(() => null);
  return used == null || used < braveLimit();
}

export type UsageSummary = {
  available: boolean; // false until migration 004 has been run
  brave: { used: number; limit: number; resetsAt: string; scansLeft: number; byProfile: { name: string; count: number }[] };
  gemini: { used: number; resetsAt: string; byProfile: { name: string; count: number }[] };
};

export async function usageSummary(): Promise<UsageSummary> {
  const limit = braveLimit();
  const empty: UsageSummary = {
    available: false,
    brave: { used: 0, limit, resetsAt: nextBraveReset(), scansLeft: Math.floor(limit / SEARCHES_PER_SCAN), byProfile: [] },
    gemini: { used: 0, resetsAt: nextGeminiReset(), byProfile: [] },
  };
  const [{ data: rows, error }, { data: profiles }] = await Promise.all([
    db().from("api_usage").select("period, service, profile_id, count").in("period", [bravePeriod(), geminiPeriod()]),
    db().from("profiles").select("id, name"),
  ]);
  if (error) return empty;

  const names = new Map((profiles ?? []).map((p) => [p.id, p.name as string]));
  const pick = (service: Service) => {
    const list = (rows ?? []).filter((r) => r.service === service && r.period === periodFor(service));
    const by = new Map<string, number>();
    for (const r of list) {
      const name = names.get(r.profile_id) ?? "Removed profile";
      by.set(name, (by.get(name) ?? 0) + r.count);
    }
    return {
      used: list.reduce((n, r) => n + r.count, 0),
      byProfile: [...by.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    };
  };
  const b = pick("brave");
  const g = pick("gemini");
  return {
    available: true,
    brave: { ...b, limit, resetsAt: nextBraveReset(), scansLeft: Math.max(0, Math.floor((limit - b.used) / SEARCHES_PER_SCAN)) },
    gemini: { ...g, resetsAt: nextGeminiReset() },
  };
}

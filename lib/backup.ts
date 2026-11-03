import { db } from "./supabase";
import { allRows } from "./paging";

/** Private bucket (not public like card-images) — backups hold everyone's data. */
export const BACKUP_BUCKET = "backups";
const KEEP = 14; // days of backups to keep
const TABLES = ["profiles", "cards", "sets", "set_cards", "api_usage"] as const;

async function ensureBucket() {
  const { data } = await db().storage.getBucket(BACKUP_BUCKET);
  if (data) return;
  const { error } = await db().storage.createBucket(BACKUP_BUCKET, { public: false });
  if (error && !/exists/i.test(error.message)) throw new Error(`Couldn't create the backups folder: ${error.message}`);
}

export type BackupFile = { name: string; created_at: string | null; size: number | null };

export async function listBackups(): Promise<BackupFile[]> {
  const { data, error } = await db().storage.from(BACKUP_BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
  if (error) return [];
  return (data ?? [])
    .filter((f) => f.name.endsWith(".json"))
    .map((f) => ({ name: f.name, created_at: f.created_at ?? f.updated_at ?? null, size: (f.metadata as { size?: number } | null)?.size ?? null }))
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Copy every table into backups/cardvault-YYYY-MM-DD.json (Sydney date), keeping the last 14. */
export async function runBackup() {
  await ensureBucket();
  const dump: Record<string, unknown[]> = {};
  for (const t of TABLES) {
    // api_usage has no id column; order by its natural key instead.
    const order = t === "api_usage" ? "period" : "id";
    const { data, error } = await allRows((from, to) => db().from(t).select("*").order(order).range(from, to));
    if (error) {
      if (t === "api_usage" || t === "sets" || t === "set_cards") { dump[t] = []; continue; } // optional tables
      throw new Error(`Backup failed reading ${t}: ${error.message}`);
    }
    dump[t] = data;
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
  const name = `cardvault-${day}.json`;
  const body = JSON.stringify({ app: "card-vault", version: 1, created_at: new Date().toISOString(), tables: dump });
  const { error } = await db().storage.from(BACKUP_BUCKET).upload(name, Buffer.from(body), { contentType: "application/json", upsert: true });
  if (error) throw new Error(`Backup upload failed: ${error.message}`);

  const old = (await listBackups()).slice(KEEP).map((f) => f.name);
  if (old.length) await db().storage.from(BACKUP_BUCKET).remove(old);
  return { name, bytes: body.length, cards: dump.cards.length, profiles: dump.profiles.length };
}

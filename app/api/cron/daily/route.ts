import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/supabase";
import { listBackups, runBackup } from "@/lib/backup";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Runs once a day from Vercel (see vercel.json).
 * 1. Keep-awake: a small database query, so Supabase's free plan never pauses the project for inactivity.
 * 2. Backup: copies all data into the private "backups" storage folder.
 * It returns no data, so it's safe to leave open; if CRON_SECRET is set in Vercel, only Vercel can run it.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed" }, { status: 401 });
  }

  const { count, error } = await db().from("profiles").select("id", { count: "exact", head: true });
  if (error) return NextResponse.json({ ok: false, awake: false, error: error.message }, { status: 500 });

  // Don't redo a backup made in the last 10 minutes (stops repeated calls wasting effort).
  const latest = (await listBackups())[0];
  if (latest?.created_at && Date.now() - Date.parse(latest.created_at) < 10 * 60_000) {
    return NextResponse.json({ ok: true, awake: true, profiles: count, backup: "recent backup already exists" });
  }
  try {
    const b = await runBackup();
    return NextResponse.json({ ok: true, awake: true, profiles: count, backup: b.name, bytes: b.bytes });
  } catch (e) {
    return NextResponse.json({ ok: false, awake: true, error: e instanceof Error ? e.message : "Backup failed" }, { status: 500 });
  }
}

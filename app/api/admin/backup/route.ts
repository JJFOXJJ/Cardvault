import { NextResponse, type NextRequest } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { BACKUP_BUCKET, listBackups, runBackup } from "@/lib/backup";

export const maxDuration = 60;

/** Admin: list backups, or download one with ?file=name. */
export async function GET(req: NextRequest) {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  const file = req.nextUrl.searchParams.get("file");
  if (!file) return NextResponse.json({ backups: await listBackups() });
  if (!/^cardvault-\d{4}-\d{2}-\d{2}\.json$/.test(file)) return jsonError("Unknown backup", 404);
  const { data, error } = await db().storage.from(BACKUP_BUCKET).download(file);
  if (error || !data) return jsonError("Couldn't load that backup", 404);
  return new NextResponse(data, {
    headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${file}"`, "cache-control": "no-store" },
  });
}

/** Admin: back up now. */
export async function POST() {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  try {
    return NextResponse.json(await runBackup());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Backup failed", 500);
  }
}

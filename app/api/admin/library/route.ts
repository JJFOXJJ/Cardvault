import { NextResponse } from "next/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { backfillLibrary } from "@/lib/backfill";
import { libraryStats } from "@/lib/shared";

export const maxDuration = 60;

export async function GET() {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  return NextResponse.json(await libraryStats());
}

/** Admin: add everyone's existing online pictures, recent prices and checklists to the shared library. */
export async function POST() {
  const me = await requireAdmin();
  if (me instanceof NextResponse) return me;
  try {
    return NextResponse.json(await backfillLibrary());
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : "Couldn't fill the library", 500);
  }
}

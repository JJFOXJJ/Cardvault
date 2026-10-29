import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, jsonError } from "@/lib/auth";
import { braveImages } from "@/lib/images";

export async function GET(req: NextRequest) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return jsonError("Missing search");
  return NextResponse.json({ candidates: await braveImages(q, 12, me.id) });
}

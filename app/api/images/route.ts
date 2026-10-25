import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { braveImages } from "@/lib/images";

export async function GET(req: NextRequest) {
  const denied = await requireAuth();
  if (denied) return denied;
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) return jsonError("Missing search");
  return NextResponse.json({ candidates: await braveImages(q, 12) });
}

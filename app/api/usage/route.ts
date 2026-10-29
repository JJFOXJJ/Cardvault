import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { usageSummary } from "@/lib/usage";

/** Shared usage across all profiles (the free allowance is shared). */
export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  return NextResponse.json(await usageSummary());
}

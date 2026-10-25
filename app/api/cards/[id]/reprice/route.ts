import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, jsonError } from "@/lib/auth";
import { db } from "@/lib/supabase";
import { describeCard, priceCard } from "@/lib/ai";
import { valueColumns } from "@/lib/fx";

export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireAuth();
  if (denied) return denied;
  const { id } = await params;

  const { data: card } = await db().from("cards").select("*").eq("id", id).single();
  if (!card) return jsonError("Card not found", 404);

  try {
    const v = await priceCard(describeCard(card));
    const update = {
      ...(await valueColumns(v.value_usd)),
      value_notes: v.value_notes,
      price_sources: v.price_sources,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db().from("cards").update(update).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json(update);
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Pricing failed", 502);
  }
}

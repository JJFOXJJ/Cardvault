import { NextResponse, type NextRequest } from "next/server";
import { requireProfile, jsonError } from "@/lib/auth";
import { cardsOf } from "@/lib/supabase";
import { describeCard, priceCard } from "@/lib/ai";
import { valueColumns } from "@/lib/fx";

export const maxDuration = 120;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);
  const { id } = await params;

  const { data: card } = await mine.select("*").eq("id", id).single();
  if (!card) return jsonError("Card not found", 404);

  try {
    const v = await priceCard(describeCard(card));
    if (v.failed) return jsonError(v.value_notes, 503);
    const update = {
      ...(await valueColumns(v.value_usd)),
      value_notes: v.value_notes,
      price_sources: v.price_sources,
      updated_at: new Date().toISOString(),
    };
    const { error } = await mine.update(update).eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json(update);
  } catch (e) {
    console.error(e);
    return jsonError(e instanceof Error ? e.message : "Pricing failed", 502);
  }
}

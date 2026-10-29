import { NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { type Card, cardsOf } from "@/lib/supabase";

const COLUMNS: (keyof Card)[] = [
  "category", "set_name", "name", "subject", "year", "manufacturer", "card_number", "variant",
  "graded", "condition", "quantity", "aud_low", "aud_mid", "aud_high", "priced_at", "notes", "image_url",
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const me = await requireProfile();
  if (me instanceof NextResponse) return me;
  const mine = cardsOf(me.id);
  const { data } = await mine.select("*").neq("status", "pending").order("set_name").order("name");
  const rows = (data ?? []) as Card[];
  const csv = [
    [...COLUMNS, "total_aud_mid"].join(","),
    ...rows.map((r) => [...COLUMNS.map((c) => cell(r[c])), cell(r.aud_mid != null ? (r.aud_mid * r.quantity).toFixed(2) : "")].join(",")),
  ].join("\n");
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="card-collection-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

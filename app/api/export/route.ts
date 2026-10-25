import { requireAuth } from "@/lib/auth";
import { db, type Card } from "@/lib/supabase";

const COLUMNS: (keyof Card)[] = [
  "category", "set_name", "name", "subject", "year", "manufacturer", "card_number", "variant",
  "graded", "condition", "quantity", "aud_low", "aud_mid", "aud_high", "priced_at", "notes", "image_url",
];

const cell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const denied = await requireAuth();
  if (denied) return denied;
  const { data } = await db().from("cards").select("*").order("set_name").order("name");
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

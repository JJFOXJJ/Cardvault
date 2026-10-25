import Header from "@/components/Header";
import Scanner, { type PendingCard } from "@/components/Scanner";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function AddCard({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const { pending: pendingId } = await searchParams;

  let pending: PendingCard | null = null;
  if (pendingId && /^[0-9a-f-]{36}$/i.test(pendingId)) {
    const { data } = await db()
      .from("cards")
      .select("id, photo_url, back_photo_url, hint, status")
      .eq("id", pendingId)
      .maybeSingle();
    if (data?.photo_url && data.status === "pending") pending = data as PendingCard;
  }

  const { count } = await db().from("cards").select("id", { count: "exact", head: true }).eq("status", "pending");

  return (
    <>
      <Header />
      <Scanner key={pending?.id ?? "new"} pending={pending} waiting={count ?? 0} />
    </>
  );
}

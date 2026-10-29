import Header from "@/components/Header";
import Scanner, { type PendingCard } from "@/components/Scanner";
import { cardsOf } from "@/lib/supabase";
import { currentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function AddCard({ searchParams }: { searchParams: Promise<{ pending?: string }> }) {
  const { pending: pendingId } = await searchParams;
  const me = await currentProfile();
  if (!me) redirect("/login");
  const mine = cardsOf(me.id);

  let pending: PendingCard | null = null;
  if (pendingId && /^[0-9a-f-]{36}$/i.test(pendingId)) {
    const { data } = await mine
      .select("id, photo_url, back_photo_url, hint, status")
      .eq("id", pendingId)
      .maybeSingle();
    if (data?.photo_url && data.status === "pending") pending = data as PendingCard;
  }

  const { count } = await mine.select("id", { count: "exact", head: true }).eq("status", "pending");

  return (
    <>
      <Header />
      <Scanner key={pending?.id ?? "new"} pending={pending} waiting={count ?? 0} />
    </>
  );
}

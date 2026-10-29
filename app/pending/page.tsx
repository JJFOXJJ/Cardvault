import Header from "@/components/Header";
import PendingList from "@/components/PendingList";
import { cardsOf, type Card } from "@/lib/supabase";
import { currentProfile } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PendingPage() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  const mine = cardsOf(me.id);
  const { data, error } = await mine
    .select("id, photo_url, back_photo_url, hint, last_error, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  return (
    <>
      <Header />
      <main className="wrap">
        {error ? (
          <p className="error">
            Couldn&apos;t load the waiting list: {error.message}. If this mentions a missing column, run{" "}
            <code>supabase/migrations/002_waiting_list.sql</code> in the Supabase SQL Editor.
          </p>
        ) : (
          <PendingList items={(data ?? []) as Pick<Card, "id" | "photo_url" | "back_photo_url" | "hint" | "last_error" | "created_at">[]} />
        )}
      </main>
    </>
  );
}

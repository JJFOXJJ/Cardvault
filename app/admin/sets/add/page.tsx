import { redirect } from "next/navigation";
import Header from "@/components/Header";
import AdminAddSet from "@/components/AdminAddSet";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Admin only: add sets (with full checklists) to the approved list and shared library. */
export default async function Page() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  if (!me.is_admin) redirect("/sets");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 860 }}>
        <AdminAddSet />
      </main>
    </>
  );
}

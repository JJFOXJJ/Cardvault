import { redirect } from "next/navigation";
import Header from "@/components/Header";
import AdminSets from "@/components/AdminSets";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  if (!me.is_admin) redirect("/sets");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 860 }}>
        <AdminSets />
      </main>
    </>
  );
}

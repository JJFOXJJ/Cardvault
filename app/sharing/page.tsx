import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Sharing from "@/components/Sharing";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 680 }}>
        <Sharing myId={me.id} />
      </main>
    </>
  );
}

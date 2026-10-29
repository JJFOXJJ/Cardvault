import { redirect } from "next/navigation";
import Header from "@/components/Header";
import Profiles from "@/components/Profiles";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function ProfilesPage() {
  const me = await currentProfile();
  if (!me) redirect("/login");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 680 }}>
        <Profiles />
      </main>
    </>
  );
}

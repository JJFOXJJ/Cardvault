import { redirect } from "next/navigation";
import Header from "@/components/Header";
import UsagePage from "@/components/Usage";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page() {
  if (!(await currentProfile())) redirect("/login");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 680 }}>
        <UsagePage />
      </main>
    </>
  );
}

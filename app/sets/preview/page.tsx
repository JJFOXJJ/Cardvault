import { redirect } from "next/navigation";
import Header from "@/components/Header";
import SetPreview from "@/components/SetPreview";
import { currentProfile } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ name?: string }> }) {
  if (!(await currentProfile())) redirect("/login");
  const name = (await searchParams).name?.trim();
  if (!name) redirect("/sets");
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 900 }}>
        <SetPreview name={name} />
      </main>
    </>
  );
}

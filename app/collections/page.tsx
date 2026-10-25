import Header from "@/components/Header";
import ManageCollections from "@/components/ManageCollections";

export const dynamic = "force-dynamic";

export default function CollectionsPage() {
  return (
    <>
      <Header />
      <main className="wrap" style={{ maxWidth: 760 }}>
        <ManageCollections />
      </main>
    </>
  );
}

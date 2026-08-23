import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { ScanUploadView } from "@/components/ScanUploadView";
import { loadGroupData } from "@/lib/group-data";
import { loadScanList } from "@/lib/receipt-data";

// The parseReceipt server action (LLM call, worst case two ~50s attempts) is
// invoked from this page — maxDuration must live on the invoking page.
export const maxDuration = 120;

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await loadGroupData(id, session.user.id);
  if (!data) notFound();
  const scans = await loadScanList(id);

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <ScanUploadView group={data} scans={scans} />
      </main>
    </div>
  );
}

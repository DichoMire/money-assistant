import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { AppHeader } from "@/components/AppHeader";
import { ScanUploadView } from "@/components/ScanUploadView";
import { loadGroupData } from "@/lib/group-data";
import { loadScanList } from "@/lib/receipt-data";
import { readScanQuota } from "@/lib/scan-usage";

// The parseReceipt server action (LLM call, worst case two ~50s attempts) is
// invoked from this page — maxDuration must live on the invoking page.
export const maxDuration = 120;

export default async function ScanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await loadGroupData(id, session.user.id);
  if (!data) notFound();
  const [scans, quota] = await Promise.all([
    loadScanList(id),
    getDb().then((db) => readScanQuota(db, session.user!.id!)),
  ]);

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <ScanUploadView group={data} scans={scans} quota={quota} />
      </main>
    </div>
  );
}

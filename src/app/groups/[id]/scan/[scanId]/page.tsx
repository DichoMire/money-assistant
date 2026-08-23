import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { ScanReviewView } from "@/components/ScanReviewView";
import { loadGroupData } from "@/lib/group-data";
import { loadScanDetail } from "@/lib/receipt-data";

export default async function ScanReviewPage({
  params,
}: {
  params: Promise<{ id: string; scanId: string }>;
}) {
  const { id, scanId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await loadGroupData(id, session.user.id);
  if (!data) notFound();
  const scan = await loadScanDetail(id, scanId);
  if (!scan) notFound();

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <ScanReviewView group={data} scan={scan} />
      </main>
    </div>
  );
}

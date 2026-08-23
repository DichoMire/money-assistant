import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { GroupView } from "@/components/GroupView";
import { loadGroupData } from "@/lib/group-data";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const data = await loadGroupData(id, session.user.id);
  if (!data) notFound();

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-6">
        <GroupView data={data} />
      </main>
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { NewGroupForm } from "@/components/NewGroupForm";
import { PendingInvites } from "@/components/PendingInvites";
import { loadGroupSummaries, loadPendingInvites } from "@/lib/group-data";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const [groups, invites] = await Promise.all([
    loadGroupSummaries(session.user.id),
    session.user.email ? loadPendingInvites(session.user.email) : Promise.resolve([]),
  ]);

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <PendingInvites invites={invites} />

        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">Your groups</h1>
          <NewGroupForm />
        </div>

        {groups.length === 0 ? (
          <div className="card px-6 py-12 text-center text-gray-500">
            <p className="text-lg font-semibold text-gray-700">No groups yet</p>
            <p className="mt-1 text-sm">
              Create a group, add the people in it, and start logging bills.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="card block px-5 py-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-lg font-bold text-gray-800">{g.name}</span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                    {g.currency}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  {g.aliasCount} {g.aliasCount === 1 ? "person" : "people"} · {g.expenseCount}{" "}
                  {g.expenseCount === 1 ? "expense" : "expenses"}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.role === "member" && (
                    <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      Member
                    </span>
                  )}
                  {g.memberCount > 1 && (
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {g.memberCount} accounts
                    </span>
                  )}
                  {g.simplifyDebts && (
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ background: "var(--brand)" }}
                    >
                      Simplified debts
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

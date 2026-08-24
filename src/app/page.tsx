import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AppHeader } from "@/components/AppHeader";
import { NewGroupForm } from "@/components/NewGroupForm";
import { loadGroupSummaries } from "@/lib/group-data";
import { countWord } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const groups = await loadGroupSummaries(session.user.id);
  const t = await getT();

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-800">{t("dashboard.yourGroups")}</h1>
          <NewGroupForm />
        </div>

        {groups.length === 0 ? (
          <div className="card px-6 py-12 text-center text-gray-500">
            <p className="text-lg font-semibold text-gray-700">{t("dashboard.noGroups")}</p>
            <p className="mt-1 text-sm">{t("dashboard.noGroupsHint")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {groups.map((g) => (
              <Link
                key={g.id}
                href={`/groups/${g.id}`}
                className="card block px-5 py-4 transition-shadow hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-lg font-bold text-gray-800">
                    {g.name}
                    {g.hasNews && (
                      <span
                        className="ml-2 inline-block h-2 w-2 rounded-full align-middle"
                        style={{ background: "var(--brand)" }}
                        title={t("dashboard.newActivity")}
                        aria-label={t("dashboard.newActivity")}
                      />
                    )}
                  </span>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                    {g.currency}
                  </span>
                </div>
                <p className="mt-2 text-sm text-gray-500">
                  {g.aliasCount} {countWord(t, g.aliasCount, "count.person", "count.people")} ·{" "}
                  {g.expenseCount} {countWord(t, g.expenseCount, "count.expense", "count.expenses")}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.role === "member" && (
                    <span className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-700">
                      {t("dashboard.memberBadge")}
                    </span>
                  )}
                  {g.memberCount > 1 && (
                    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">
                      {t("count.accounts", { count: g.memberCount })}
                    </span>
                  )}
                  {g.simplifyDebts && (
                    <span
                      className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ background: "var(--brand)" }}
                    >
                      {t("dashboard.simplifiedDebts")}
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

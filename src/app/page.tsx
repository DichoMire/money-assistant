import Link from "next/link";
import { cookies } from "next/headers";
import { eq, isNull, and } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { AppHeader } from "@/components/AppHeader";
import { LandingPage } from "@/components/LandingPage";
import { NewGroupForm } from "@/components/NewGroupForm";
import { loadGroupSummaries } from "@/lib/group-data";
import { countWord } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";

/**
 * SEO metadata for the (logged-out) Bulgarian landing at "/". Keyword-bearing
 * title (the brand alone is generic); Bulgarian is x-default on purpose —
 * this is a bg-first product targeting an empty Bulgarian SERP (RFC 10).
 */
export const metadata = {
  title: "Money Assistant — приложение за общи разходи и разделяне на сметки",
  description:
    "Групови разходи за почивки, квартири и излизания. Неограничени записи, безплатно сканиране на бонове, без реклами — работи в браузъра, без инсталация.",
  alternates: {
    canonical: "/",
    languages: { bg: "/", en: "/en", "x-default": "/" },
  },
  openGraph: {
    type: "website",
    siteName: "Money Assistant",
    locale: "bg_BG",
    alternateLocale: "en_US",
    title: "Money Assistant — приложение за общи разходи",
    description: "Неограничени разходи. Безплатно сканиране на бонове. Без реклами.",
    images: [{ url: "/og/card-bg.png", width: 1200, height: 630 }],
  },
  twitter: { card: "summary_large_image" as const },
};

/** One-time channel attribution: the ?ref= cookie set on the landing becomes
 *  users.signup_ref on the first authenticated dashboard render (first-touch,
 *  never overwritten). Deliberately not in auth.ts — this visit is
 *  attribution-equivalent to signup. */
async function captureSignupRef(userId: string) {
  try {
    const ref = (await cookies()).get("ref")?.value;
    if (!ref || !/^[a-z0-9-]{1,32}$/.test(ref)) return;
    const db = await getDb();
    await db
      .update(users)
      .set({ signupRef: ref })
      .where(and(eq(users.id, userId), isNull(users.signupRef)));
  } catch {}
}

export default async function DashboardPage() {
  const session = await auth();
  // The root URL is the marketing surface for logged-out visitors — always
  // Bulgarian (RFC 10's SEO strategy; /en is the English twin). Logged-in
  // behavior is unchanged: the dashboard.
  if (!session?.user?.id) return <LandingPage locale="bg" />;
  await captureSignupRef(session.user.id);
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

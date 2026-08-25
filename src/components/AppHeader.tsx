import Link from "next/link";
import { and, eq, isNull, sql } from "drizzle-orm";
import { signOut } from "@/auth";
import { getDb } from "@/db";
import { notifications, users } from "@/db/schema";
import { getLocale, getT } from "@/lib/i18n-server";
import { BrandMark } from "./BrandMark";
import { LanguageToggle } from "./LanguageToggle";
import { NotificationsBell } from "./NotificationsBell";
import { PoliciesBanner } from "./PoliciesBanner";

/** Per-render header state: policies notice + unread bell count, one query
 *  each. Also lazily syncs users.locale with the request locale so email can
 *  speak the recipient's language (RFC 07) — a write only when they differ. */
async function headerState(
  email: string | null | undefined,
  locale: string
): Promise<{ showPolicies: boolean; unreadCount: number }> {
  if (!email) return { showPolicies: false, unreadCount: 0 };
  try {
    const db = await getDb();
    const rows = await db
      .select({
        id: users.id,
        acceptedAt: users.policiesAcceptedAt,
        locale: users.locale,
      })
      .from(users)
      .where(eq(users.email, email));
    const me = rows[0];
    if (!me) return { showPolicies: false, unreadCount: 0 };
    if (me.locale !== locale) {
      void db.update(users).set({ locale }).where(eq(users.id, me.id)).catch(() => {});
    }
    const unread = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, me.id), isNull(notifications.readAt)));
    return { showPolicies: me.acceptedAt === null, unreadCount: unread[0]?.count ?? 0 };
  } catch {
    return { showPolicies: false, unreadCount: 0 }; // never break the header
  }
}

export async function AppHeader({ user }: { user: { name?: string | null; email?: string | null } }) {
  const t = await getT();
  const locale = await getLocale();
  const { showPolicies, unreadCount } = await headerState(user.email, locale);
  return (
    <header className="border-b border-gray-200 bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-3 py-3 sm:px-4">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-gray-800">
          <BrandMark size="sm" />
          Money Assistant
        </Link>
        {/* shrink-0 + nowrap: header controls keep their one-line size; only
            the brand text on the left is allowed to wrap on narrow phones. */}
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
          <span className="hidden text-sm text-gray-500 sm:inline">
            {user.name ?? user.email}
          </span>
          <NotificationsBell initialUnread={unreadCount} />
          <Link
            href="/settings"
            className="rounded-lg px-1.5 py-1.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 sm:px-2"
            aria-label={t("header.settings")}
            title={t("header.settings")}
          >
            ⚙
          </Link>
          <LanguageToggle />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="btn btn-secondary whitespace-nowrap !py-1.5 !px-2 sm:!px-3">
              {t("header.signOut")}
            </button>
          </form>
        </div>
      </div>
      {showPolicies && <PoliciesBanner />}
    </header>
  );
}

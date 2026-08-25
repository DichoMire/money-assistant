import Link from "next/link";
import { eq } from "drizzle-orm";
import { signOut } from "@/auth";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { getT } from "@/lib/i18n-server";
import { BrandMark } from "./BrandMark";
import { LanguageToggle } from "./LanguageToggle";
import { PoliciesBanner } from "./PoliciesBanner";

/** True when the account has not yet dismissed the policies notice. */
async function needsPoliciesNotice(email?: string | null): Promise<boolean> {
  if (!email) return false;
  try {
    const db = await getDb();
    const rows = await db
      .select({ acceptedAt: users.policiesAcceptedAt })
      .from(users)
      .where(eq(users.email, email));
    return rows.length > 0 && rows[0].acceptedAt === null;
  } catch {
    return false; // the banner must never break the header
  }
}

export async function AppHeader({ user }: { user: { name?: string | null; email?: string | null } }) {
  const t = await getT();
  const showPolicies = await needsPoliciesNotice(user.email);
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

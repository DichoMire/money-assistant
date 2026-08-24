import Link from "next/link";
import { signOut } from "@/auth";
import { getT } from "@/lib/i18n-server";
import { LanguageToggle } from "./LanguageToggle";

export async function AppHeader({ user }: { user: { name?: string | null; email?: string | null } }) {
  const t = await getT();
  return (
    <header className="border-b border-gray-200 bg-white pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="flex items-center gap-2 text-lg font-bold text-gray-800">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--brand)" }}
          >
            $
          </span>
          Money Assistant
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-sm text-gray-500 sm:inline">
            {user.name ?? user.email}
          </span>
          <LanguageToggle />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="btn btn-secondary !px-3 !py-1.5">
              {t("header.signOut")}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

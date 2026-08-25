import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { AccountSettings } from "@/components/AccountSettings";
import { AppHeader } from "@/components/AppHeader";
import { getT } from "@/lib/i18n-server";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  const t = await getT();

  return (
    <div className="min-h-screen">
      <AppHeader user={session.user} />
      <main className="mx-auto max-w-xl px-4 py-8">
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
          {t("account.back")}
        </Link>
        <h1 className="mt-2 mb-6 text-2xl font-bold text-gray-800">{t("account.title")}</h1>
        <AccountSettings
          user={{
            name: session.user.name ?? "",
            email: session.user.email ?? "",
          }}
        />
      </main>
    </div>
  );
}

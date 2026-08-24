import Link from "next/link";
import { getT } from "@/lib/i18n-server";

export default async function NotFound() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm px-6 py-8 text-center">
        <p className="text-3xl" aria-hidden>🔍</p>
        <h1 className="mt-2 text-lg font-bold text-gray-800">{t("notFound.title")}</h1>
        <p className="mt-2 text-sm text-gray-500">{t("notFound.hint")}</p>
        <Link href="/" className="btn btn-primary mt-5">{t("join.goToGroups")}</Link>
      </div>
    </main>
  );
}

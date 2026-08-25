import { BrandMark } from "@/components/BrandMark";
import { getT } from "@/lib/i18n-server";

/** Auth.js verifyRequest page — where the magic-link form lands after
 *  sending. Branded, instead of the unstyled Auth.js default. */
export default async function CheckEmailPage() {
  const t = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm px-6 py-8 text-center">
        <BrandMark />
        <h1 className="text-xl font-bold text-gray-800">{t("login.checkEmailTitle")}</h1>
        <p className="mt-2 text-sm text-gray-500">{t("login.checkEmailBody")}</p>
        <p className="mt-4 text-xs text-gray-400">{t("login.checkEmailHint")}</p>
      </div>
    </main>
  );
}

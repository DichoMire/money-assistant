import { redirect } from "next/navigation";
import { auth, devLoginEnabled, hasGoogleAuth, magicLinkEnabled, signIn } from "@/auth";
import { BrandMark } from "@/components/BrandMark";
import { LanguageToggle } from "@/components/LanguageToggle";
import { OpenInBrowserHint } from "@/components/OpenInBrowserHint";
import { getT } from "@/lib/i18n-server";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;
  // Only same-site relative redirect targets (e.g. /join/<token>) are honored.
  const redirectTo =
    callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//")
      ? callbackUrl
      : "/";
  const session = await auth();
  if (session?.user) redirect(redirectTo);
  const t = await getT();

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card relative w-full max-w-sm px-6 py-8 text-center">
        <div className="absolute top-3 right-3">
          <LanguageToggle />
        </div>
        <BrandMark />
        <h1 className="text-xl font-bold text-gray-800">Money Assistant</h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">{t("app.tagline")}</p>

        {/* Viber/Messenger in-app browsers can dead-end at Google OAuth
            (disallowed_useragent) — every Viber-opened invite for a
            logged-out user lands here, so the escape hint goes first. */}
        <OpenInBrowserHint />

        {hasGoogleAuth && (
          <form
            action={async () => {
              "use server";
              await signIn("google", { redirectTo });
            }}
          >
            <button type="submit" className="btn btn-secondary w-full !py-2.5">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
              {t("login.continueWithGoogle")}
            </button>
          </form>
        )}

        {magicLinkEnabled && (
          <form
            className="mt-4 border-t border-gray-100 pt-4"
            action={async (formData: FormData) => {
              "use server";
              await signIn("magic", { email: formData.get("email"), redirectTo });
            }}
          >
            <p className="label !mb-2 text-left">{t("login.magicTitle")}</p>
            <div className="flex gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="input"
              />
              <button type="submit" className="btn btn-secondary shrink-0">
                {t("login.magicSend")}
              </button>
            </div>
          </form>
        )}

        {devLoginEnabled && (
          <form
            className="mt-4 border-t border-gray-100 pt-4"
            action={async (formData: FormData) => {
              "use server";
              await signIn("dev-login", {
                email: formData.get("email"),
                redirectTo,
              });
            }}
          >
            <p className="label !mb-2 text-left">{t("login.devLogin")}</p>
            <div className="flex gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="input"
              />
              <button type="submit" className="btn btn-primary shrink-0">
                {t("login.signIn")}
              </button>
            </div>
          </form>
        )}

        {!hasGoogleAuth && !devLoginEnabled && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t("login.notConfigured1")} <code>AUTH_GOOGLE_ID</code> {t("login.notConfigured2")}{" "}
            <code>AUTH_GOOGLE_SECRET</code> {t("login.notConfigured3")}
          </p>
        )}

        {/* Trust strip — plain-language answers to the three fears the
            research surfaced (bank access, data, who made this). */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-gray-400">
          <span>{t("login.trust1")}</span>
          <span aria-hidden>·</span>
          <span>{t("login.trust2")}</span>
          <span aria-hidden>·</span>
          <span>{t("login.trust3")}</span>
        </div>

        {/* Sign-in-wrap consent (contract basis — accept terms, acknowledge
            the privacy notice); no checkbox by design (RFC 08 §3.4). */}
        <p className="mt-5 text-xs leading-relaxed text-gray-400">
          {t("login.consentPre")}{" "}
          <a className="underline hover:text-gray-600" href="/terms">
            {t("login.consentTerms")}
          </a>{" "}
          {t("login.consentMid")}{" "}
          <a className="underline hover:text-gray-600" href="/privacy">
            {t("login.consentPrivacy")}
          </a>
          . {t("login.consentAge")}
        </p>
      </div>
    </main>
  );
}

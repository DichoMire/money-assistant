import { redirect } from "next/navigation";
import { auth, devLoginEnabled, hasGoogleAuth, signIn } from "@/auth";

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

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="card w-full max-w-sm px-6 py-8 text-center">
        <span
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-bold text-white"
          style={{ background: "var(--brand)" }}
        >
          $
        </span>
        <h1 className="text-xl font-bold text-gray-800">Money Assistant</h1>
        <p className="mt-1 mb-6 text-sm text-gray-500">
          Track group expenses, split bills, and simplify who pays whom.
        </p>

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
              Continue with Google
            </button>
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
            <p className="label !mb-2 text-left">Dev login (local only)</p>
            <div className="flex gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="you@example.com"
                className="input"
              />
              <button type="submit" className="btn btn-primary shrink-0">
                Sign in
              </button>
            </div>
          </form>
        )}

        {!hasGoogleAuth && !devLoginEnabled && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Google sign-in is not configured. Set <code>AUTH_GOOGLE_ID</code> and{" "}
            <code>AUTH_GOOGLE_SECRET</code> in the environment.
          </p>
        )}
      </div>
    </main>
  );
}

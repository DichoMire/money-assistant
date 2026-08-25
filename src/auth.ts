import NextAuth from "next-auth";
import { sql } from "drizzle-orm";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import { getDb } from "@/db";
import { users } from "@/db/schema";

export const hasGoogleAuth = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
// Passwordless dev login is only ever offered in local development builds.
export const devLoginEnabled = !hasGoogleAuth && process.env.NODE_ENV === "development";

const providers: Provider[] = [];
if (hasGoogleAuth) providers.push(Google);
if (devLoginEnabled) {
  providers.push(
    Credentials({
      id: "dev-login",
      name: "Dev login",
      credentials: { email: { label: "Email" } },
      async authorize(credentials) {
        const email = typeof credentials?.email === "string" ? credentials.email.trim() : "";
        if (!email.includes("@")) return null;
        return { email, name: email.split("@")[0] };
      },
    })
  );
}

async function ensureUser(email: string, name?: string | null, image?: string | null) {
  const db = await getDb();
  const rows = await db
    .insert(users)
    // New accounts sign in through the login page, whose consent line covers
    // the policies — stamp acceptance at creation. Existing rows keep their
    // value (the conflict-set below doesn't touch it), so pre-policy accounts
    // see the one-time banner instead.
    .values({ email, name: name ?? null, image: image ?? null, policiesAcceptedAt: new Date() })
    .onConflictDoUpdate({
      target: users.email,
      // COALESCE: a provider that sends no profile (e.g. an email magic link)
      // must never null-wipe the name/avatar Google provided earlier.
      set: {
        name: sql`COALESCE(EXCLUDED.name, ${users.name})`,
        image: sql`COALESCE(EXCLUDED.image, ${users.image})`,
      },
    })
    .returning();
  return rows[0];
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers,
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  secret:
    process.env.AUTH_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-only-secret-do-not-use-in-prod" : undefined),
  callbacks: {
    async signIn({ account, profile }) {
      // Email is our identity and invite-matching key. Google accounts can
      // carry unverified addresses (non-Gmail signups), which would allow
      // impersonating someone else's email — require verification.
      if (account?.provider === "google") {
        return profile?.email_verified === true;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await ensureUser(user.email, user.name, user.image);
        token.uid = dbUser.id;
      } else if (devLoginEnabled && typeof token.email === "string") {
        // Local dev databases get wiped and recreated, and a session JWT
        // minted against an old database then carries a stale uid — every
        // insert referencing users.id fails its FK. Re-upsert by email so
        // stale dev sessions heal instead of erroring. Dev login only;
        // production (Google) sessions are untouched.
        const dbUser = await ensureUser(
          token.email,
          typeof token.name === "string" ? token.name : null
        );
        token.uid = dbUser.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) session.user.id = token.uid as string;
      return session;
    },
  },
});

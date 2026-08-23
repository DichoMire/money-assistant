import NextAuth from "next-auth";
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
    .values({ email, name: name ?? null, image: image ?? null })
    .onConflictDoUpdate({
      target: users.email,
      set: { name: name ?? null, image: image ?? null },
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
    async jwt({ token, user }) {
      if (user?.email) {
        const dbUser = await ensureUser(user.email, user.name, user.image);
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

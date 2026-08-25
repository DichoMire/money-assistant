import NextAuth from "next-auth";
import { and, eq, sql } from "drizzle-orm";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import type { Provider } from "next-auth/providers";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import { getDb } from "@/db";
import { users, verificationTokens } from "@/db/schema";
import { emailEnabled, emailShell, sendRawEmail } from "@/lib/email";
import { getLocale } from "@/lib/i18n-server";
import { makeT } from "@/lib/i18n";
import { rateLimit } from "@/lib/rate-limit";

export const hasGoogleAuth = !!(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
// Passwordless dev login is only ever offered in local development builds.
export const devLoginEnabled = !hasGoogleAuth && process.env.NODE_ENV === "development";
/** Email magic links exist only once the email layer is configured
 *  (RESEND_API_KEY + EMAIL_FROM) — dormant until then (RFC 06 §3.a). */
export const magicLinkEnabled = emailEnabled();

function toAdapterUser(row: typeof users.$inferSelect): AdapterUser {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified,
    name: row.name,
    image: row.image,
  };
}

/**
 * Minimal custom adapter — ONLY what the email + JWT flow touches. The app
 * stays deliberately adapter-less otherwise: JWT sessions, users upserted by
 * email (the identity/invite-matching key), no accounts/sessions tables.
 * OAuth account linking is resolved by verified email instead (see
 * allowDangerousEmailAccountLinking below — safe here precisely because
 * Google sign-ins require email_verified and magic links prove possession).
 */
function minimalAdapter(): Adapter {
  return {
    async createUser(user) {
      const row = await ensureUser(user.email, user.name ?? null, user.image ?? null);
      return toAdapterUser(row);
    },
    async getUser(id) {
      const db = await getDb();
      const rows = await db.select().from(users).where(eq(users.id, id));
      return rows[0] ? toAdapterUser(rows[0]) : null;
    },
    async getUserByEmail(email) {
      const db = await getDb();
      const rows = await db.select().from(users).where(eq(users.email, email));
      return rows[0] ? toAdapterUser(rows[0]) : null;
    },
    async getUserByAccount() {
      return null; // no accounts table by design — email resolves identity
    },
    async updateUser(user) {
      const db = await getDb();
      const rows = await db
        .update(users)
        .set({
          // COALESCE-style: never null-wipe what another provider supplied.
          ...(user.name != null ? { name: user.name } : {}),
          ...(user.image != null ? { image: user.image } : {}),
          ...(user.emailVerified != null ? { emailVerified: user.emailVerified } : {}),
        })
        .where(eq(users.id, user.id))
        .returning();
      return toAdapterUser(rows[0]);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async linkAccount(account: any) {
      return account; // intentionally not stored
    },
    async createVerificationToken(vt) {
      const db = await getDb();
      await db.insert(verificationTokens).values(vt);
      return vt;
    },
    async useVerificationToken({ identifier, token }) {
      const db = await getDb();
      const rows = await db
        .delete(verificationTokens)
        .where(
          and(eq(verificationTokens.identifier, identifier), eq(verificationTokens.token, token))
        )
        .returning();
      return rows[0] ?? null; // single-use: delete-on-read
    },
  };
}

const providers: Provider[] = [];
if (hasGoogleAuth) providers.push(Google({ allowDangerousEmailAccountLinking: true }));
if (magicLinkEnabled) {
  providers.push({
    id: "magic",
    type: "email",
    name: "Email",
    from: process.env.EMAIL_FROM!,
    maxAge: 15 * 60, // links die after 15 minutes
    options: {},
    async sendVerificationRequest({ identifier, url }) {
      const db = await getDb();
      // A send-email endpoint must never run unthrottled: 3 links/hour/email.
      const rl = await rateLimit(db, `magic:${identifier.toLowerCase()}`, {
        max: 3,
        windowSec: 3600,
      });
      if (!rl.ok) throw new Error("Too many sign-in links requested — try again later.");
      const locale = await getLocale().catch(() => "en" as const);
      const t = makeT(locale);
      const { html } = emailShell({
        locale,
        footerUnsubscribeHref: `${process.env.APP_URL ?? ""}/login`,
        bodyHtml: `<p style="font-size:15px;line-height:1.5">${t("email.magicBody")}</p>
  <p><a href="${url}" style="display:inline-block;background:#1cc29f;color:#fff;text-decoration:none;border-radius:8px;padding:10px 18px;font-weight:600">${t("email.magicCta")}</a></p>
  <p style="font-size:12px;color:#9ca3af">${t("email.magicExpiry")}</p>`,
      });
      const ok = await sendRawEmail({
        to: identifier,
        subject: t("email.magicSubject"),
        html,
        text: `${t("email.magicBody")}\n${url}`,
      });
      if (!ok) throw new Error("Could not send the sign-in email.");
    },
  });
}
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
  // The adapter exists solely for the magic-link verification tokens;
  // sessions stay JWT and no accounts table exists (see minimalAdapter).
  ...(magicLinkEnabled ? { adapter: minimalAdapter() } : {}),
  trustHost: true,
  session: { strategy: "jwt" },
  pages: { signIn: "/login", verifyRequest: "/login/check-email" },
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

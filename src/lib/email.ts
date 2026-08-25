import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { groupMembers, groups, notifications, users } from "@/db/schema";
import { appBaseUrl } from "./invites";
import { makeT, type Locale, isLocale } from "./i18n";
import { describeNotification } from "./notify";
import type { NotifyPrefs } from "./types";

/**
 * Email layer (RFC 07 §3.3): Resend via its plain REST API — no SDK, the
 * OpenRouter/Frankfurter pattern. Hand-rolled table-free transactional HTML
 * (a deliberate deviation from the RFC's react-email suggestion: three short
 * templates don't justify two dependencies; revisit if templates multiply).
 *
 * DORMANT without RESEND_API_KEY + EMAIL_FROM: every send silently no-ops,
 * so the whole layer ships ahead of the DNS/domain setup.
 *
 * THE ANTI-SETTLE-UP POLICY: exactly two notification types may ever be
 * emailed immediately — group.added_you and settle.reminder (user-initiated).
 * Everything else reaches email exclusively through the daily digest. No
 * marketing category exists, by design.
 */

export function emailEnabled(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendRawEmail(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}): Promise<boolean> {
  if (!emailEnabled()) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        text: params.text,
        headers: params.headers,
      }),
    });
    if (!res.ok) {
      console.error(`[email] Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

type Recipient = typeof users.$inferSelect;

function unsubscribeUrl(user: Recipient, cat: string): string {
  return `${appBaseUrl()}/api/email/unsubscribe?token=${user.unsubscribeToken}&cat=${cat}`;
}

/** Minimal shared shell: brand bar, content, footer with unsubscribe. */
export function emailShell(params: {
  locale: Locale;
  bodyHtml: string;
  footerUnsubscribeHref: string;
}): { html: string; footerText: string } {
  const t = makeT(params.locale);
  const footer = t("email.unsubscribe");
  return {
    html: `<div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;padding:16px;color:#1f2937">
  <div style="font-weight:700;font-size:18px;margin-bottom:16px"><span style="display:inline-block;background:#1cc29f;color:#fff;border-radius:8px;padding:2px 9px">€</span> Money Assistant</div>
  ${params.bodyHtml}
  <p style="margin-top:28px;font-size:12px;color:#9ca3af"><a href="${params.footerUnsubscribeHref}" style="color:#9ca3af">${footer}</a></p>
</div>`,
    footerText: footer,
  };
}

/**
 * Guard-railed send of one notification row by email (RFC 07 §3.3): the
 * recipient must exist, still be a member (or owner) of the group, not be
 * globally unsubscribed, and not have the category muted — checked at SEND
 * time, so a preference change between event and send is honored. Localized
 * with the RECIPIENT's stored locale. Marks the row emailed on success.
 */
export async function sendNotificationEmail(
  db: Db,
  notificationId: string,
  recipientUserId: string,
  groupId: string,
  type: string,
  actorName: string,
  groupName: string,
  details: Record<string, unknown>
): Promise<void> {
  if (!emailEnabled()) return;
  try {
    const [userRows, groupRows, memberRows] = await Promise.all([
      db.select().from(users).where(eq(users.id, recipientUserId)),
      db.select().from(groups).where(eq(groups.id, groupId)),
      db
        .select()
        .from(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, recipientUserId))),
    ]);
    const user = userRows[0];
    const group = groupRows[0];
    if (!user || !group) return;
    const isMember = group.userId === recipientUserId || memberRows.length > 0;
    if (!isMember) return; // never email anyone no longer in the group (G7)
    if (user.unsubscribedAt) return;
    const prefs: NotifyPrefs = user.notifyPrefs ?? {};
    if (type === "group.added_you" && prefs.emailAddedToGroup === false) return;
    if (type === "settle.reminder" && prefs.emailReminders === false) return;

    const locale: Locale = isLocale(user.locale) ? user.locale : "en";
    const t = makeT(locale);
    const line = describeNotification(type, actorName, details, t);
    const cat = type === "settle.reminder" ? "reminders" : "addedToGroup";
    const href = unsubscribeUrl(user, cat);
    const groupUrl = `${appBaseUrl()}/groups/${groupId}`;
    const subject =
      type === "settle.reminder"
        ? t("email.reminderSubject", { actor: actorName, group: groupName })
        : t("email.addedSubject", { actor: actorName, group: groupName });
    const { html } = emailShell({
      locale,
      footerUnsubscribeHref: href,
      bodyHtml: `<p style="font-size:15px;line-height:1.5">${line}</p>
  <p style="font-size:15px"><strong>${groupName}</strong></p>
  <p><a href="${groupUrl}" style="display:inline-block;background:#1cc29f;color:#fff;text-decoration:none;border-radius:8px;padding:9px 16px;font-weight:600">${t("email.openGroup")}</a></p>`,
    });
    const ok = await sendRawEmail({
      to: user.email,
      subject,
      html,
      text: `${line}\n${groupUrl}`,
      headers: {
        "List-Unsubscribe": `<${href}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (ok) {
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(eq(notifications.id, notificationId));
    }
  } catch (error) {
    console.error("[email] notification email failed:", error);
  }
}

/** Resend free tier caps 100/day; leave headroom for immediate sends. */
const DIGEST_DAILY_SEND_CAP = 90;
/** Window cap: an ancient backlog can never dump into one digest. */
const DIGEST_WINDOW_DAYS = 14;

/**
 * The daily digest (RFC 07 §3.3): everything that is not one of the two
 * immediate types reaches email ONLY here — one "what happened" email per
 * user per day, batched per group, recipient-locale, empty ⇒ no email.
 * Idempotent (emailedAt stamps), catch-up after missed days, oldest-pending
 * first, deferring the overflow beyond the send cap to tomorrow.
 */
export async function runDailyDigest(db: Db): Promise<{ sent: number; deferred: number }> {
  if (!emailEnabled()) return { sent: 0, deferred: 0 };
  const cutoff = new Date(Date.now() - DIGEST_WINDOW_DAYS * 86_400_000);
  const pending = await db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.emailedAt), gt(notifications.createdAt, cutoff)))
    .orderBy(asc(notifications.createdAt));
  if (pending.length === 0) return { sent: 0, deferred: 0 };

  // Order users by their oldest pending row (fairness under the cap).
  const byUser = new Map<string, typeof pending>();
  for (const row of pending) {
    const list = byUser.get(row.userId) ?? [];
    list.push(row);
    byUser.set(row.userId, list);
  }
  const userIds = [...byUser.keys()];
  const userRows = await db.select().from(users).where(inArray(users.id, userIds));
  const userById = new Map(userRows.map((u) => [u.id, u]));
  const isMonday = new Date().getDay() === 1;

  let sent = 0;
  let deferred = 0;
  for (const [userId, rows] of byUser) {
    const user = userById.get(userId);
    if (!user || user.unsubscribedAt) continue;
    const prefs: NotifyPrefs = user.notifyPrefs ?? {};
    const cadence = prefs.digest ?? "daily";
    if (cadence === "off") continue;
    if (cadence === "weekly" && !isMonday) continue;
    if (sent >= DIGEST_DAILY_SEND_CAP) {
      deferred += 1;
      continue;
    }

    // Membership guard at send time: only groups the user is still in.
    const groupIds = [...new Set(rows.map((r) => r.groupId))];
    const [ownedRows, memberRows] = await Promise.all([
      db
        .select({ id: groups.id })
        .from(groups)
        .where(and(inArray(groups.id, groupIds), eq(groups.userId, userId))),
      db
        .select({ id: groupMembers.groupId })
        .from(groupMembers)
        .where(and(inArray(groupMembers.groupId, groupIds), eq(groupMembers.userId, userId))),
    ]);
    const allowed = new Set([...ownedRows, ...memberRows].map((r) => r.id));
    const sendable = rows.filter((r) => allowed.has(r.groupId));
    if (sendable.length === 0) continue;

    const locale: Locale = isLocale(user.locale) ? user.locale : "en";
    const t = makeT(locale);
    const sections = new Map<string, { name: string; lines: string[] }>();
    for (const r of sendable) {
      const section = sections.get(r.groupId) ?? { name: r.groupName, lines: [] };
      section.lines.push(describeNotification(r.type, r.actorName, r.details, t));
      sections.set(r.groupId, section);
    }
    const href = unsubscribeUrl(user, "digest");
    const bodyHtml = [...sections.entries()]
      .map(
        ([groupId, s]) =>
          `<p style="font-size:15px;margin:14px 0 4px"><a href="${appBaseUrl()}/groups/${groupId}" style="color:#0f766e;font-weight:700;text-decoration:none">${s.name}</a></p>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.6;color:#374151">${s.lines
            .map((l) => `<li>${l}</li>`)
            .join("")}</ul>`
      )
      .join("");
    const { html } = emailShell({ locale, footerUnsubscribeHref: href, bodyHtml });
    const text = [...sections.values()]
      .map((s) => `${s.name}\n${s.lines.map((l) => `- ${l}`).join("\n")}`)
      .join("\n\n");
    const ok = await sendRawEmail({
      to: user.email,
      subject: t("email.digestSubject"),
      html,
      text,
      headers: {
        "List-Unsubscribe": `<${href}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (ok) {
      sent += 1;
      await db
        .update(notifications)
        .set({ emailedAt: new Date() })
        .where(inArray(notifications.id, sendable.map((r) => r.id)));
    }
  }
  if (deferred > 0) console.error(`[digest] send cap hit — ${deferred} users deferred to tomorrow`);
  return { sent, deferred };
}

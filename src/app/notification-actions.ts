"use server";

import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, notifications, users } from "@/db/schema";
import { fail, logActivity, notifyUsers, requireRole, requireUser } from "@/lib/action-helpers";
import { loadGroupData } from "@/lib/group-data";
import { getT } from "@/lib/i18n-server";
import type { ActionResult, NotificationDto, NotifyPrefs } from "@/lib/types";

/** The latest ~30 notifications for the bell panel (viewer-locale rendering
 *  happens client-side via describeNotification). */
export async function getNotifications(): Promise<NotificationDto[]> {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, user.id))
    .orderBy(desc(notifications.createdAt))
    .limit(30);
  return rows.map((r) => ({
    id: r.id,
    groupId: r.groupId,
    groupName: r.groupName,
    type: r.type,
    actorName: r.actorName,
    details: r.details,
    readAt: r.readAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** Opening the panel marks the listed rows read. */
export async function markNotificationsRead(ids: string[]): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (ids.length === 0) return { ok: true };
    const db = await getDb();
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          inArray(notifications.id, ids.slice(0, 100)),
          isNull(notifications.readAt)
        )
      );
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function getNotifySettings(): Promise<{
  prefs: NotifyPrefs;
  unsubscribedAll: boolean;
}> {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, user.id));
  return {
    prefs: rows[0]?.notifyPrefs ?? {},
    unsubscribedAll: !!rows[0]?.unsubscribedAt,
  };
}

export async function updateNotifyPrefs(prefs: NotifyPrefs): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const clean: NotifyPrefs = {};
    if (prefs.digest === "daily" || prefs.digest === "weekly" || prefs.digest === "off") {
      clean.digest = prefs.digest;
    }
    if (typeof prefs.emailAddedToGroup === "boolean") clean.emailAddedToGroup = prefs.emailAddedToGroup;
    if (typeof prefs.emailReminders === "boolean") clean.emailReminders = prefs.emailReminders;
    await db.update(users).set({ notifyPrefs: clean }).where(eq(users.id, user.id));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Clears the global unsubscribe (the "получавай имейли отново" button). */
export async function resubscribeEmails(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await db.update(users).set({ unsubscribedAt: null }).where(eq(users.id, user.id));
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * User-initiated „напомни" (RFC 07 §3.4): creditor → debtor, server-verified
 * debt, one reminder per debtor per group per 7 days, neutral wording. The
 * recipient's mute preference is honored silently at send time — the sender
 * never learns another user's settings.
 */
export async function sendSettleReminder(
  groupId: string,
  debtorAliasId: string
): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "member");

    const debtorAlias = (
      await db.select().from(aliases).where(eq(aliases.id, debtorAliasId))
    )[0];
    if (!debtorAlias || debtorAlias.groupId !== groupId || !debtorAlias.userId) {
      return { ok: false, error: t("errors.personNotFound") };
    }

    // Never trust client amounts: recompute the debt server-side from the
    // same math the panel displays.
    const data = await loadGroupData(groupId, user.id);
    if (!data) return { ok: false, error: t("errors.groupNotFound") };
    const myAliasId = data.aliases.find((a) => a.userId === user.id)?.id;
    if (!myAliasId) return { ok: false, error: t("errors.notAMember") };
    const debts = data.simplifyDebts ? data.simplifiedDebts : data.pairwiseDebts;
    const debt = debts.find((d) => d.fromAliasId === debtorAliasId && d.toAliasId === myAliasId);
    if (!debt) return { ok: false, error: t("reminder.noDebt") };

    // Rate limit via the notifications table itself: one reminder per debtor
    // per group per 7 days, regardless of sender.
    const recent = await db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, debtorAlias.userId),
          eq(notifications.groupId, groupId),
          eq(notifications.type, "settle.reminder"),
          gt(notifications.createdAt, sql`now() - interval '7 days'`)
        )
      )
      .limit(1);
    if (recent.length > 0) return { ok: false, error: t("reminder.tooSoon") };

    await notifyUsers(db, [debtorAlias.userId], {
      groupId,
      groupName: group.name,
      type: "settle.reminder",
      actor: user,
      details: { amountCents: debt.amountCents, currency: group.currency },
    });
    await logActivity(db, groupId, user, "reminder.sent", {
      name: debtorAlias.name,
      amountCents: debt.amountCents,
      currency: group.currency,
    });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

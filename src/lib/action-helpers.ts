import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { Db } from "@/db";
import { activityLog, notifications } from "@/db/schema";
import { sendNotificationEmail } from "./email";
import { getMembership } from "./group-data";
import { IMMEDIATE_EMAIL_TYPES } from "./notify";
import { enT, type TFunc } from "./i18n";
import { getT } from "./i18n-server";
import type { GroupRole } from "./types";

/**
 * Shared plumbing for server-action modules. Lives outside the "use server"
 * files because those may only export async server actions.
 */

export type SessionUser = { id: string; email: string; name: string };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) throw new Error((await getT())("errors.notSignedIn"));
  return { id: user.id, email: user.email, name: user.name ?? user.email };
}

/** Membership gate: "member" allows both roles, "owner" only the owner. */
export async function requireRole(db: Db, groupId: string, userId: string, minRole: GroupRole) {
  const membership = await getMembership(db, groupId, userId);
  if (!membership) throw new Error((await getT())("errors.groupNotFound"));
  if (minRole === "owner" && membership.role !== "owner") {
    throw new Error((await getT())("errors.onlyOwner"));
  }
  return membership;
}

export async function fail(error: unknown): Promise<{ ok: false; error: string }> {
  const t: TFunc = await getT().catch(() => enT);
  return {
    ok: false,
    error: error instanceof Error ? error.message : t("errors.somethingWentWrong"),
  };
}

export function revalidateGroup(groupId: string) {
  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Write per-recipient notification rows (RFC 07), with the same
 * swallow-errors contract as logActivity — a notification failure must never
 * fail the action. The actor is always excluded; recipients are computed by
 * the CALLER (the data is in scope at every call site; log rows lack it).
 * The two immediate-email types are sent fire-and-forget from here; every
 * other type reaches email only through the daily digest.
 */
export async function notifyUsers(
  db: Db,
  recipientUserIds: (string | null | undefined)[],
  params: {
    groupId: string;
    groupName: string;
    type: string;
    refId?: string | null;
    actor: SessionUser;
    details?: Record<string, unknown>;
  }
) {
  try {
    const ids = [...new Set(recipientUserIds.filter((id): id is string => !!id))].filter(
      (id) => id !== params.actor.id
    );
    if (ids.length === 0) return;
    const rows = await db
      .insert(notifications)
      .values(
        ids.map((userId) => ({
          userId,
          groupId: params.groupId,
          groupName: params.groupName,
          type: params.type,
          refId: params.refId ?? null,
          actorName: params.actor.name,
          details: params.details ?? {},
        }))
      )
      .returning({ id: notifications.id, userId: notifications.userId });
    if ((IMMEDIATE_EMAIL_TYPES as readonly string[]).includes(params.type)) {
      // Fire-and-forget: the response never waits on the mail provider.
      for (const row of rows) {
        void sendNotificationEmail(
          db,
          row.id,
          row.userId,
          params.groupId,
          params.type,
          params.actor.name,
          params.groupName,
          params.details ?? {}
        );
      }
    }
  } catch (error) {
    console.error("[notify] failed to write notifications:", error);
  }
}

/** Append to the group's audit trail; never lets a logging failure break the action. */
export async function logActivity(
  db: Db,
  groupId: string,
  actor: SessionUser,
  action: string,
  details: Record<string, unknown> = {}
) {
  try {
    await db.insert(activityLog).values({
      groupId,
      actorUserId: actor.id,
      actorName: actor.name,
      action,
      details,
    });
  } catch (error) {
    console.error("[activity] failed to log:", error);
  }
}

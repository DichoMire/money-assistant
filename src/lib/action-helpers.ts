import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { Db } from "@/db";
import { activityLog } from "@/db/schema";
import { getMembership } from "./group-data";
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

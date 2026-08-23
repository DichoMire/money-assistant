import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import type { Db } from "@/db";
import { activityLog } from "@/db/schema";
import { getMembership } from "./group-data";
import type { GroupRole } from "./types";

/**
 * Shared plumbing for server-action modules. Lives outside the "use server"
 * files because those may only export async server actions.
 */

export type SessionUser = { id: string; email: string; name: string };

export async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) throw new Error("Not signed in.");
  return { id: user.id, email: user.email, name: user.name ?? user.email };
}

/** Membership gate: "member" allows both roles, "owner" only the owner. */
export async function requireRole(db: Db, groupId: string, userId: string, minRole: GroupRole) {
  const membership = await getMembership(db, groupId, userId);
  if (!membership) throw new Error("Group not found.");
  if (minRole === "owner" && membership.role !== "owner") {
    throw new Error("Only the group owner can do that.");
  }
  return membership;
}

export function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
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

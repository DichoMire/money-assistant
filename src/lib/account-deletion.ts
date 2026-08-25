import { and, eq, inArray, sql } from "drizzle-orm";
import { withTransaction, type Db } from "@/db";
import {
  activityLog,
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  groupMembers,
  groups,
  users,
} from "@/db/schema";
import { ACTIVITY_TOMBSTONE, type DeletionOverview } from "./types";

/**
 * The account-deletion engine (RFC 08 §3.1), separated from the server-action
 * shell so it is directly testable against PGlite. Semantics: shared data is
 * detached (Art. 17(3) balancing — the ledger is other members' record too),
 * data only the user can see is hard-deleted, actor names are tombstoned.
 * Every step leaves the database consistent on its own and the whole run is
 * idempotent — a re-run after a mid-flight crash finishes the job.
 */

export async function classifyGroupsForDeletion(
  db: Db,
  userId: string
): Promise<DeletionOverview> {
  const [owned, memberships] = await Promise.all([
    db.select().from(groups).where(eq(groups.userId, userId)),
    db
      .select({ group: groups })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(eq(groupMembers.userId, userId)),
  ]);

  const ownedIds = owned.map((g) => g.id);
  const memberRows = ownedIds.length
    ? await db
        .select({
          groupId: groupMembers.groupId,
          userId: groupMembers.userId,
          name: users.name,
          email: users.email,
        })
        .from(groupMembers)
        .innerJoin(users, eq(groupMembers.userId, users.id))
        .where(inArray(groupMembers.groupId, ownedIds))
    : [];
  const membersByGroup = new Map<string, { userId: string; name: string }[]>();
  for (const m of memberRows) {
    const list = membersByGroup.get(m.groupId) ?? [];
    list.push({ userId: m.userId, name: m.name ?? m.email.split("@")[0] });
    membersByGroup.set(m.groupId, list);
  }

  return {
    memberGroups: memberships.map((m) => ({ id: m.group.id, name: m.group.name })),
    soloGroups: owned
      .filter((g) => !membersByGroup.has(g.id))
      .map((g) => ({ id: g.id, name: g.name })),
    conflictedGroups: owned
      .filter((g) => membersByGroup.has(g.id))
      .map((g) => ({ id: g.id, name: g.name, members: membersByGroup.get(g.id)! })),
  };
}

/** Best-effort audit entry; a logging failure must never abort deletion. */
async function tryLog(
  db: Db,
  groupId: string,
  actor: { id: string; name: string },
  action: string,
  details: Record<string, unknown>
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
    console.error("[account-deletion] failed to log:", error);
  }
}

/**
 * Execute the deletion steps. The caller must have verified there are no
 * conflicted groups (owned groups with other real members) — this function
 * re-checks and throws if any remain, as a guard against racing joins.
 */
export async function executeAccountDeletion(
  db: Db,
  user: { id: string; name: string; email: string }
): Promise<void> {
  const overview = await classifyGroupsForDeletion(db, user.id);
  if (overview.conflictedGroups.length > 0) {
    throw new Error("conflicted groups remain — resolve before deleting");
  }

  // 1. Leave every shared group: detach the alias (history stays, as a
  //    virtual member) and drop the membership. Names only in the log.
  for (const g of overview.memberGroups) {
    const aliasRows = await db
      .select()
      .from(aliases)
      .where(and(eq(aliases.groupId, g.id), eq(aliases.userId, user.id)));
    await db
      .update(aliases)
      .set({ userId: null })
      .where(and(eq(aliases.groupId, g.id), eq(aliases.userId, user.id)));
    await db
      .delete(groupMembers)
      .where(and(eq(groupMembers.groupId, g.id), eq(groupMembers.userId, user.id)));
    await tryLog(db, g.id, user, "member.left", { name: aliasRows[0]?.name ?? user.name });
  }

  // 2. Solo-owned groups (virtual members at most): entirely the user's own
  //    data — hard delete, same teardown order as deleteGroup.
  for (const g of overview.soloGroups) {
    await withTransaction(async (tx) => {
      const groupExpenseIds = tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.groupId, g.id));
      await tx.delete(expensePayers).where(inArray(expensePayers.expenseId, groupExpenseIds));
      await tx.delete(expenseShares).where(inArray(expenseShares.expenseId, groupExpenseIds));
      await tx.delete(expenses).where(eq(expenses.groupId, g.id));
      await tx.delete(aliases).where(eq(aliases.groupId, g.id));
      await tx.delete(groups).where(eq(groups.id, g.id));
    });
  }

  // 3. Receipt photos the user uploaded into surviving groups: parsed items
  //    stay (group ledger); the photo is the user's personal artifact — gone.
  await db.execute(sql`
    DELETE FROM receipt_scan_images
    WHERE scan_id IN (SELECT id FROM receipt_scans WHERE created_by = ${user.id})
  `);

  // 4. Tombstone the audit trail's actor names (rendered per-locale as
  //    "изтрит потребител"/"deleted user"). Emails were scrubbed from all
  //    details in migration 0009 and are never written since.
  await db
    .update(activityLog)
    .set({ actorName: ACTIVITY_TOMBSTONE })
    .where(eq(activityLog.actorUserId, user.id));

  // 5. The users row. Remaining FKs: set-null (aliases already null,
  //    activity_log.actor_user_id, receipt_scans.created_by) or cascade
  //    (group_invites.created_by — only their own groups' links). The
  //    groups.user_id FK is RESTRICT, so a bug that left an owned group
  //    behind fails loudly here instead of cascading into shared data.
  await db.delete(users).where(eq(users.id, user.id));
}

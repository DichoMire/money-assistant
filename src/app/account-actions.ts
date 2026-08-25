"use server";

import { and, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { signOut } from "@/auth";
import { getDb, withTransaction } from "@/db";
import {
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  groupMembers,
  groups,
  receiptItems,
  receiptScans,
  users,
} from "@/db/schema";
import { fail, logActivity, requireRole, requireUser } from "@/lib/action-helpers";
import { classifyGroupsForDeletion, executeAccountDeletion } from "@/lib/account-deletion";
import { getT } from "@/lib/i18n-server";
import type { ActionResult, DeletionOverview } from "@/lib/types";

/**
 * Account-level actions: profile, GDPR export (Art. 15/20) and deletion
 * (Art. 17). Deletion semantics for shared data follow the app's existing
 * detach model: a shared ledger is simultaneously the record of what OTHER
 * members are owed (Art. 17(3) balancing), so shared expenses stay while the
 * person is unlinked; hard delete is reserved for data only the user can see.
 */

const EXPORT_COOLDOWN_MS = 10 * 60 * 1000;

export async function updateProfile(name: string): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: t("errors.nameRequired") };
    if (trimmed.length > 80) return { ok: false, error: t("errors.nameTooLong") };
    const db = await getDb();
    // Deliberately touches only users.name: per-group aliases and denormalized
    // activity-log names are historical/group data and stay as they are.
    await db.update(users).set({ name: trimmed }).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Stamp that the user saw the "we published terms/privacy" notice. */
export async function acknowledgePolicies(): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await db.update(users).set({ policiesAcceptedAt: new Date() }).where(eq(users.id, user.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Classify the user's groups for the deletion flow. */
export async function getDeletionOverview(): Promise<DeletionOverview> {
  const user = await requireUser();
  const db = await getDb();
  return classifyGroupsForDeletion(db, user.id);
}

/**
 * Hand a group to one of its members (owner-only). Independently useful, and
 * the deletion flow's resolution path for owned shared groups.
 */
export async function transferGroupOwnership(
  groupId: string,
  newOwnerId: string
): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "owner");
    if (newOwnerId === user.id) return { ok: false, error: t("errors.notAMember") };
    const memberRow = await db
      .select()
      .from(groupMembers)
      .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, newOwnerId)));
    if (!memberRow[0]) return { ok: false, error: t("errors.notAMember") };

    await withTransaction(async (tx) => {
      await tx.update(groups).set({ userId: newOwnerId }).where(eq(groups.id, groupId));
      // The owner has no group_members row by convention: promote the new
      // owner out of the members table, demote the old owner into it.
      await tx
        .delete(groupMembers)
        .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, newOwnerId)));
      await tx
        .insert(groupMembers)
        .values({ groupId, userId: user.id })
        .onConflictDoNothing();
    });

    const targetRows = await db.select().from(users).where(eq(users.id, newOwnerId));
    await logActivity(db, groupId, user, "group.ownership_transferred", {
      name: targetRows[0]?.name ?? targetRows[0]?.email?.split("@")[0] ?? "?",
      groupName: group.name,
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Immediate, self-serve account deletion. Ordered so every step leaves the
 * database consistent on its own, and idempotent: re-running after a
 * mid-flight failure skips already-done work and finishes the job.
 * On success the session is terminated (the redirect happens server-side —
 * outside performDeletion's try/catch so it is never swallowed as an error).
 */
export async function deleteAccount(confirmEmail: string): Promise<ActionResult> {
  const result = await performDeletion(confirmEmail);
  if (result.ok) {
    await signOut({ redirectTo: "/login" });
  }
  return result;
}

async function performDeletion(confirmEmail: string): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
      return { ok: false, error: t("errors.confirmEmailMismatch") };
    }
    const db = await getDb();
    const overview = await classifyGroupsForDeletion(db, user.id);
    if (overview.conflictedGroups.length > 0) {
      return { ok: false, error: t("errors.resolveOwnedGroups") };
    }
    await executeAccountDeletion(db, user);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Art. 15/20 export: one JSON document with everything the account can see
 * about itself. Synchronous by design — realistic accounts are a few thousand
 * small rows. Receipt photos are not embedded (they'd need an archive format);
 * they remain individually downloadable via the authenticated image route
 * while the account exists, and each scan entry carries that URL.
 */
export async function exportAccountData(): Promise<
  { ok: true; data: Record<string, unknown> } | { ok: false; error: string }
> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();

    const userRows = await db.select().from(users).where(eq(users.id, user.id));
    const me = userRows[0];
    if (!me) return { ok: false, error: t("errors.somethingWentWrong") };
    if (me.lastExportAt && Date.now() - me.lastExportAt.getTime() < EXPORT_COOLDOWN_MS) {
      return { ok: false, error: t("errors.exportThrottled") };
    }
    await db.update(users).set({ lastExportAt: new Date() }).where(eq(users.id, user.id));

    const [owned, memberships] = await Promise.all([
      db.select().from(groups).where(eq(groups.userId, user.id)),
      db
        .select({ group: groups })
        .from(groupMembers)
        .innerJoin(groups, eq(groupMembers.groupId, groups.id))
        .where(eq(groupMembers.userId, user.id)),
    ]);
    const allGroups = [
      ...owned.map((g) => ({ group: g, role: "owner" as const })),
      ...memberships.map((m) => ({ group: m.group, role: "member" as const })),
    ];
    const groupIds = allGroups.map((g) => g.group.id);

    const myAliases = groupIds.length
      ? await db
          .select()
          .from(aliases)
          .where(and(inArray(aliases.groupId, groupIds), eq(aliases.userId, user.id)))
      : [];
    const aliasByGroup = new Map(myAliases.map((a) => [a.groupId, a]));
    const myAliasIds = myAliases.map((a) => a.id);

    // Expenses where the user's alias appears as payer or share-holder
    // (settlements included — same table). Other members' expenses that never
    // touch the user are not the user's data.
    const involvedIds = myAliasIds.length
      ? await db
          .selectDistinct({ id: expensePayers.expenseId })
          .from(expensePayers)
          .where(inArray(expensePayers.aliasId, myAliasIds))
          .union(
            db
              .selectDistinct({ id: expenseShares.expenseId })
              .from(expenseShares)
              .where(inArray(expenseShares.aliasId, myAliasIds))
          )
      : [];
    const expenseIds = involvedIds.map((r) => r.id);
    const [expenseRows, payerRows, shareRows] = expenseIds.length
      ? await Promise.all([
          db.select().from(expenses).where(inArray(expenses.id, expenseIds)),
          db
            .select({
              expenseId: expensePayers.expenseId,
              paidCents: expensePayers.paidCents,
              name: aliases.name,
            })
            .from(expensePayers)
            .innerJoin(aliases, eq(expensePayers.aliasId, aliases.id))
            .where(inArray(expensePayers.expenseId, expenseIds)),
          db
            .select({
              expenseId: expenseShares.expenseId,
              owedCents: expenseShares.owedCents,
              splitValue: expenseShares.splitValue,
              name: aliases.name,
            })
            .from(expenseShares)
            .innerJoin(aliases, eq(expenseShares.aliasId, aliases.id))
            .where(inArray(expenseShares.expenseId, expenseIds)),
        ])
      : [[], [], []];

    const scans = await db
      .select()
      .from(receiptScans)
      .where(eq(receiptScans.createdBy, user.id))
      .orderBy(desc(receiptScans.createdAt));
    const scanIds = scans.map((s) => s.id);
    const itemRows = scanIds.length
      ? await db.select().from(receiptItems).where(inArray(receiptItems.scanId, scanIds))
      : [];

    const data = {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      profile: {
        id: me.id,
        email: me.email,
        name: me.name,
        image: me.image,
        createdAt: me.createdAt.toISOString(),
      },
      groups: allGroups.map(({ group, role }) => ({
        id: group.id,
        name: group.name,
        currency: group.currency,
        simplifyDebts: group.simplifyDebts,
        role,
        myAlias: aliasByGroup.get(group.id)
          ? { id: aliasByGroup.get(group.id)!.id, name: aliasByGroup.get(group.id)!.name }
          : null,
        expenses: expenseRows
          .filter((e) => e.groupId === group.id)
          .map((e) => ({
            id: e.id,
            kind: e.kind,
            description: e.description,
            amountCents: e.amountCents,
            currency: e.currency,
            date: e.date,
            splitMethod: e.splitMethod,
            payers: payerRows
              .filter((p) => p.expenseId === e.id)
              .map((p) => ({ name: p.name, paidCents: p.paidCents })),
            shares: shareRows
              .filter((s) => s.expenseId === e.id)
              .map((s) => ({ name: s.name, owedCents: s.owedCents, splitValue: s.splitValue })),
          })),
      })),
      receiptScans: scans.map((s) => ({
        id: s.id,
        groupId: s.groupId,
        merchant: s.merchant,
        date: s.date,
        currency: s.currency,
        totalCents: s.totalCents,
        taxCents: s.taxCents,
        tipCents: s.tipCents,
        discountsCents: s.discountsCents,
        reconciles: s.reconciles,
        createdAt: s.createdAt.toISOString(),
        imageUrl: `/api/receipts/${s.id}/image`,
        items: itemRows
          .filter((i) => i.scanId === s.id)
          .map((i) => ({
            name: i.name,
            rawText: i.rawText,
            quantity: i.quantity,
            unitPriceCents: i.unitPriceCents,
            totalCents: i.totalCents,
          })),
      })),
      // activity log entries are group records, not user records — available
      // in-app; deliberately not exported (documented decision, RFC 08 §3.2).
    };
    return { ok: true, data };
  } catch (e) {
    return fail(e);
  }
}

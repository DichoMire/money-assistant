"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, type Db } from "@/db";
import {
  activityLog,
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  groupInvites,
  groupMembers,
  groups,
  users,
} from "@/db/schema";
import {
  DATE_RE,
  fail,
  logActivity,
  requireRole,
  requireUser,
  revalidateGroup,
  type SessionUser,
} from "@/lib/action-helpers";
import { isSupportedCurrency } from "@/lib/currencies";
import { formatDate } from "@/lib/format";
import { getMembership, loadCircle } from "@/lib/group-data";
import { mergeAliasReferences } from "@/lib/merge-alias";
import { formatCents } from "@/lib/money";
import { inviteExpiry, inviteIsUsable, joinUrl, newInviteToken } from "@/lib/invites";
import { refreshRates } from "@/lib/rates-fetch";
import {
  computeShares,
  validatePayers,
  SPLIT_METHODS,
  SPLIT_METHOD_LABELS,
  type SplitMethod,
} from "@/lib/split";
import type {
  ActionResult,
  ActivityEntryDto,
  CircleUserDto,
  ExpenseInput,
  InviteLinkDto,
  SettlementInput,
} from "@/lib/types";

function participantSummary(ids: string[], names: Map<string, string>): string {
  if (ids.length > 4) return `${ids.length} people`;
  return ids.map((id) => names.get(id) ?? "?").join(", ");
}

/**
 * Human-readable fragments describing what an expense edit changed, computed
 * against the rows as they were before the update. Distribution-only tweaks
 * are reported generically, and changes implied by an amount or method change
 * are not repeated.
 */
function buildExpenseChanges(params: {
  oldExpense: { description: string; amountCents: number; currency: string; date: string; splitMethod: string };
  oldPayers: { aliasId: string; paidCents: number }[];
  oldShares: { aliasId: string; owedCents: number }[];
  input: ExpenseInput;
  description: string;
  newShares: { aliasId: string; owedCents: number }[];
  aliasNames: Map<string, string>;
}): string[] {
  const { oldExpense, oldPayers, oldShares, input, description, newShares, aliasNames } = params;
  const changes: string[] = [];
  const amountChanged =
    oldExpense.amountCents !== input.amountCents || oldExpense.currency !== input.currency;
  const methodChanged = oldExpense.splitMethod !== input.splitMethod;

  if (oldExpense.description !== description) {
    changes.push(`description "${oldExpense.description}" → "${description}"`);
  }
  if (amountChanged) {
    changes.push(
      `amount ${formatCents(oldExpense.amountCents, oldExpense.currency)} → ${formatCents(input.amountCents, input.currency)}`
    );
  }
  if (oldExpense.date !== input.date) {
    changes.push(`date ${formatDate(oldExpense.date)} → ${formatDate(input.date)}`);
  }
  if (methodChanged) {
    changes.push(
      `split method ${SPLIT_METHOD_LABELS[oldExpense.splitMethod as SplitMethod]} → ${SPLIT_METHOD_LABELS[input.splitMethod]}`
    );
  }

  const sortedIds = (ids: string[]) => [...ids].sort().join(",");
  const payerKey = (l: { aliasId: string; paidCents: number }[]) =>
    l.map((p) => `${p.aliasId}:${p.paidCents}`).sort().join(",");
  const oldPayerIds = oldPayers.map((p) => p.aliasId).sort();
  const newPayerIds = input.payers.map((p) => p.aliasId).sort();
  if (sortedIds(oldPayerIds) !== sortedIds(newPayerIds)) {
    changes.push(
      `paid by ${participantSummary(oldPayerIds, aliasNames)} → ${participantSummary(newPayerIds, aliasNames)}`
    );
  } else if (!amountChanged && payerKey(oldPayers) !== payerKey(input.payers)) {
    changes.push("payer amounts adjusted");
  }

  const shareKey = (l: { aliasId: string; owedCents: number }[]) =>
    l.map((s) => `${s.aliasId}:${s.owedCents}`).sort().join(",");
  const oldShareIds = oldShares.map((s) => s.aliasId).sort();
  const newShareIds = newShares.map((s) => s.aliasId).sort();
  if (sortedIds(oldShareIds) !== sortedIds(newShareIds)) {
    changes.push(
      `split between ${participantSummary(oldShareIds, aliasNames)} → ${participantSummary(newShareIds, aliasNames)}`
    );
  } else if (!amountChanged && !methodChanged && shareKey(oldShares) !== shareKey(newShares)) {
    changes.push("split amounts adjusted");
  }
  return changes;
}

/** The group's audit trail, newest first (visible to every member). */
export async function getActivityLog(groupId: string): Promise<ActivityEntryDto[]> {
  const user = await requireUser();
  const db = await getDb();
  await requireRole(db, groupId, user.id, "member");
  const rows = await db
    .select()
    .from(activityLog)
    .where(eq(activityLog.groupId, groupId))
    .orderBy(desc(activityLog.createdAt))
    .limit(200);
  return rows.map((r) => ({
    id: r.id,
    actorName: r.actorName,
    action: r.action,
    details: r.details,
    createdAt: r.createdAt.toISOString(),
  }));
}

// ---------- Groups ----------

export async function createGroup(name: string, currency: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Group name is required." };
    if (!isSupportedCurrency(currency)) return { ok: false, error: "Unsupported currency." };
    const db = await getDb();
    const rows = await db
      .insert(groups)
      .values({ userId: user.id, name: trimmed, currency })
      .returning({ id: groups.id });
    // The owner participates too — give them a linked alias from the start.
    await createLinkedAlias(db, rows[0].id, user);
    await logActivity(db, rows[0].id, user, "group.created", { name: trimmed });
    revalidatePath("/");
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return fail(e);
  }
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; currency?: string; simplifyDebts?: boolean }
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "owner");
    const set: Partial<typeof groups.$inferInsert> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return { ok: false, error: "Group name is required." };
      set.name = trimmed;
    }
    if (patch.currency !== undefined) {
      if (!isSupportedCurrency(patch.currency)) return { ok: false, error: "Unsupported currency." };
      set.currency = patch.currency;
    }
    if (patch.simplifyDebts !== undefined) set.simplifyDebts = patch.simplifyDebts;
    if (Object.keys(set).length > 0) {
      await db.update(groups).set(set).where(eq(groups.id, groupId));
      if (set.name !== undefined && set.name !== group.name) {
        await logActivity(db, groupId, user, "group.renamed", { from: group.name, to: set.name });
      }
      if (set.currency !== undefined && set.currency !== group.currency) {
        await logActivity(db, groupId, user, "group.currency_changed", {
          from: group.currency,
          to: set.currency,
        });
      }
      if (set.simplifyDebts !== undefined && set.simplifyDebts !== group.simplifyDebts) {
        await logActivity(db, groupId, user, "group.simplify_toggled", { on: set.simplifyDebts });
      }
    }
    revalidateGroup(groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteGroup(groupId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await requireRole(db, groupId, user.id, "owner");
    // FK order: aliases are referenced by payers/shares with RESTRICT, so
    // remove transactions first, then aliases, then the group.
    const groupExpenses = await db
      .select({ id: expenses.id })
      .from(expenses)
      .where(eq(expenses.groupId, groupId));
    for (const e of groupExpenses) {
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, e.id));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, e.id));
    }
    await db.delete(expenses).where(eq(expenses.groupId, groupId));
    await db.delete(aliases).where(eq(aliases.groupId, groupId));
    await db.delete(groups).where(eq(groups.id, groupId));
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Aliases (participants) ----------

/** Reuse the user's linked alias in the group or create one with a free name. */
async function createLinkedAlias(
  db: Db,
  groupId: string,
  user: { id: string; email: string; name: string }
) {
  const existing = await db.select().from(aliases).where(eq(aliases.groupId, groupId));
  const already = existing.find((a) => a.userId === user.id);
  if (already) return already;
  const base = (user.name || user.email.split("@")[0]).trim() || "Member";
  const names = new Set(existing.map((a) => a.name.toLowerCase()));
  let name = base;
  for (let n = 2; names.has(name.toLowerCase()); n += 1) name = `${base} ${n}`;
  const rows = await db.insert(aliases).values({ groupId, name, userId: user.id }).returning();
  return rows[0];
}

export async function addAlias(groupId: string, name: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Name is required." };
    const db = await getDb();
    await requireRole(db, groupId, user.id, "owner");
    const existing = await db.select().from(aliases).where(eq(aliases.groupId, groupId));
    if (existing.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: `"${trimmed}" is already in this group.` };
    }
    const rows = await db
      .insert(aliases)
      .values({ groupId, name: trimmed })
      .returning({ id: aliases.id });
    await logActivity(db, groupId, user, "alias.added", { name: trimmed });
    revalidateGroup(groupId);
    return { ok: true, id: rows[0].id };
  } catch (e) {
    return fail(e);
  }
}

async function requireAliasInOwnedGroup(db: Db, aliasId: string, userId: string) {
  const rows = await db.select().from(aliases).where(eq(aliases.id, aliasId));
  const alias = rows[0];
  if (!alias) throw new Error("Person not found.");
  await requireRole(db, alias.groupId, userId, "owner");
  return alias;
}

export async function renameAlias(aliasId: string, name: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Name is required." };
    const db = await getDb();
    const rows = await db.select().from(aliases).where(eq(aliases.id, aliasId));
    const alias = rows[0];
    if (!alias) return { ok: false, error: "Person not found." };
    // The owner renames anyone in their group; a member renames only the
    // participant linked to their own account.
    const { role } = await requireRole(db, alias.groupId, user.id, "member");
    if (role !== "owner" && alias.userId !== user.id) {
      return { ok: false, error: "You can only rename yourself." };
    }
    await db.update(aliases).set({ name: trimmed }).where(eq(aliases.id, aliasId));
    if (trimmed !== alias.name) {
      await logActivity(db, alias.groupId, user, "alias.renamed", { from: alias.name, to: trimmed });
    }
    revalidateGroup(alias.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAlias(aliasId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const alias = await requireAliasInOwnedGroup(db, aliasId, user.id);
    if (alias.userId) {
      return { ok: false, error: "This person is a group member. Remove the member instead." };
    }
    const [paid, owed] = await Promise.all([
      db.select({ id: expensePayers.expenseId }).from(expensePayers).where(eq(expensePayers.aliasId, aliasId)).limit(1),
      db.select({ id: expenseShares.expenseId }).from(expenseShares).where(eq(expenseShares.aliasId, aliasId)).limit(1),
    ]);
    if (paid.length > 0 || owed.length > 0) {
      return {
        ok: false,
        error: `${alias.name} is part of existing expenses. Delete or edit those expenses first.`,
      };
    }
    await db.delete(aliases).where(eq(aliases.id, aliasId));
    await logActivity(db, alias.groupId, user, "alias.deleted", { name: alias.name });
    revalidateGroup(alias.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Attach a virtual member to a real account in the group. If the account
 * already has its own participant alias, that alias's expense history is
 * merged into the virtual one and removed — the virtual alias (and its name)
 * becomes the account's identity in the group.
 */
export async function attachAlias(aliasId: string, targetUserId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const alias = await requireAliasInOwnedGroup(db, aliasId, user.id);
    if (alias.userId) {
      return { ok: false, error: "This person is already linked to an account." };
    }
    const membership = await getMembership(db, alias.groupId, targetUserId);
    if (!membership) {
      return { ok: false, error: "That account is not a member of this group." };
    }
    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, alias.groupId));
    const existing = groupAliases.find((a) => a.userId === targetUserId);
    if (existing) {
      await mergeAliasReferences(db, existing.id, alias.id);
      await db.delete(aliases).where(eq(aliases.id, existing.id));
    }
    await db.update(aliases).set({ userId: targetUserId }).where(eq(aliases.id, alias.id));
    const targetRows = await db.select().from(users).where(eq(users.id, targetUserId));
    await logActivity(db, alias.groupId, user, "alias.attached", {
      aliasName: alias.name,
      accountName: targetRows[0]?.name ?? targetRows[0]?.email ?? "?",
      accountEmail: targetRows[0]?.email ?? "?",
      merged: !!existing,
    });
    revalidateGroup(alias.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Members, circle, invites ----------

/** Detach the user's alias (back to virtual) and drop their membership. */
async function detachMember(db: Db, groupId: string, targetUserId: string) {
  await db
    .update(aliases)
    .set({ userId: null })
    .where(and(eq(aliases.groupId, groupId), eq(aliases.userId, targetUserId)));
  await db
    .delete(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, targetUserId)));
}

export async function removeMember(groupId: string, targetUserId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "owner");
    if (targetUserId === group.userId) {
      return { ok: false, error: "The owner cannot be removed." };
    }
    await detachMember(db, groupId, targetUserId);
    const targetRows = await db.select().from(users).where(eq(users.id, targetUserId));
    await logActivity(db, groupId, user, "member.removed", {
      name: targetRows[0]?.name ?? targetRows[0]?.email ?? "?",
      email: targetRows[0]?.email ?? "?",
    });
    revalidateGroup(groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function leaveGroup(groupId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const { role } = await requireRole(db, groupId, user.id, "member");
    if (role === "owner") {
      return { ok: false, error: "The owner cannot leave their own group. Delete it instead." };
    }
    await detachMember(db, groupId, user.id);
    await logActivity(db, groupId, user, "member.left", { email: user.email });
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Circle accounts that could be added to this group (not yet in it). */
export async function getCircleForGroup(groupId: string): Promise<CircleUserDto[]> {
  const user = await requireUser();
  const db = await getDb();
  const { group } = await requireRole(db, groupId, user.id, "owner");
  const [circle, memberRows] = await Promise.all([
    loadCircle(user.id),
    db.select({ userId: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId)),
  ]);
  const inGroup = new Set([group.userId, ...memberRows.map((r) => r.userId)]);
  return circle.filter((c) => !inGroup.has(c.userId));
}

/** Instantly add someone from the owner's circle as a member. */
export async function addCircleMember(groupId: string, targetUserId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await requireRole(db, groupId, user.id, "owner");
    const circle = await loadCircle(user.id);
    if (!circle.some((c) => c.userId === targetUserId)) {
      return { ok: false, error: "You can only add people you already share a group with." };
    }
    const targetRows = await db.select().from(users).where(eq(users.id, targetUserId));
    const target = targetRows[0];
    if (!target) return { ok: false, error: "Account not found." };
    await joinGroup(db, groupId, {
      id: target.id,
      email: target.email,
      name: target.name ?? target.email,
    });
    await logActivity(db, groupId, user, "member.joined", {
      name: target.name ?? target.email,
      email: target.email,
      via: "circle",
    });
    revalidateGroup(groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

async function joinGroup(db: Db, groupId: string, user: SessionUser) {
  await db
    .insert(groupMembers)
    .values({ groupId, userId: user.id })
    .onConflictDoNothing();
  await createLinkedAlias(db, groupId, user);
}

async function findActiveLink(db: Db, groupId: string) {
  const rows = await db
    .select()
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        eq(groupInvites.status, "active"),
        gt(groupInvites.expiresAt, new Date())
      )
    );
  return rows[0] ?? null;
}

function toLinkDto(row: { id: string; token: string; expiresAt: Date }): InviteLinkDto {
  return { id: row.id, url: joinUrl(row.token), expiresAt: row.expiresAt.toISOString().slice(0, 10) };
}

/** The group's currently active invite link, if any (owner only). */
export async function getInviteLink(groupId: string): Promise<InviteLinkDto | null> {
  const user = await requireUser();
  const db = await getDb();
  await requireRole(db, groupId, user.id, "owner");
  const link = await findActiveLink(db, groupId);
  return link ? toLinkDto(link) : null;
}

/** Return the existing active invite link, or create a fresh 7-day one. */
export async function createInviteLink(groupId: string): Promise<InviteLinkDto> {
  const user = await requireUser();
  const db = await getDb();
  await requireRole(db, groupId, user.id, "owner");
  const existing = await findActiveLink(db, groupId);
  if (existing) return toLinkDto(existing);
  const rows = await db
    .insert(groupInvites)
    .values({ groupId, token: newInviteToken(), createdBy: user.id, expiresAt: inviteExpiry() })
    .returning();
  await logActivity(db, groupId, user, "invite.created", {
    expiresAt: rows[0].expiresAt.toISOString().slice(0, 10),
  });
  return toLinkDto(rows[0]);
}

export async function revokeInvite(inviteId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db.select().from(groupInvites).where(eq(groupInvites.id, inviteId));
    const invite = rows[0];
    if (!invite) return { ok: false, error: "Invite not found." };
    await requireRole(db, invite.groupId, user.id, "owner");
    await db.update(groupInvites).set({ status: "revoked" }).where(eq(groupInvites.id, inviteId));
    await logActivity(db, invite.groupId, user, "invite.revoked", {});
    revalidateGroup(invite.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function acceptInvite(token: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db.select().from(groupInvites).where(eq(groupInvites.token, token));
    const invite = rows[0];
    if (!invite) return { ok: false, error: "This invite link is not valid." };

    const membership = await getMembership(db, invite.groupId, user.id);
    if (membership) return { ok: true, id: invite.groupId };
    if (!inviteIsUsable(invite)) {
      return { ok: false, error: "This invite has expired. Ask for a new one." };
    }

    await joinGroup(db, invite.groupId, user);
    await logActivity(db, invite.groupId, user, "member.joined", {
      name: user.name,
      email: user.email,
      via: "link",
    });
    revalidateGroup(invite.groupId);
    return { ok: true, id: invite.groupId };
  } catch (e) {
    return fail(e);
  }
}

// ---------- Expenses ----------

export async function saveExpense(input: ExpenseInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await requireRole(db, input.groupId, user.id, "member");

    const description = input.description.trim();
    if (!description) return { ok: false, error: "Description is required." };
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Unsupported currency." };
    if (!DATE_RE.test(input.date)) return { ok: false, error: "Invalid date." };
    if (!SPLIT_METHODS.includes(input.splitMethod)) return { ok: false, error: "Invalid split method." };

    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, input.groupId));
    const aliasIds = new Set(groupAliases.map((a) => a.id));
    const payerIds = input.payers.map((p) => p.aliasId);
    const splitIds = input.splits.map((s) => s.aliasId);
    if (
      payerIds.some((id) => !aliasIds.has(id)) ||
      splitIds.some((id) => !aliasIds.has(id)) ||
      new Set(payerIds).size !== payerIds.length ||
      new Set(splitIds).size !== splitIds.length
    ) {
      return { ok: false, error: "Invalid participants." };
    }

    const payerError = validatePayers(input.amountCents, input.payers, input.currency);
    if (payerError) return { ok: false, error: payerError };

    const split = computeShares(input.splitMethod, input.amountCents, input.splits, input.currency);
    if (!split.ok) return { ok: false, error: split.error };

    let expenseId = input.id;
    let oldExpense: typeof expenses.$inferSelect | null = null;
    let oldPayers: { aliasId: string; paidCents: number }[] = [];
    let oldShares: { aliasId: string; owedCents: number }[] = [];
    if (expenseId) {
      const existing = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Expense not found." };
      oldExpense = existing[0];
      [oldPayers, oldShares] = await Promise.all([
        db.select().from(expensePayers).where(eq(expensePayers.expenseId, expenseId)),
        db.select().from(expenseShares).where(eq(expenseShares.expenseId, expenseId)),
      ]);
      await db
        .update(expenses)
        .set({
          description,
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: input.splitMethod,
          kind: "expense",
        })
        .where(eq(expenses.id, expenseId));
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    } else {
      const rows = await db
        .insert(expenses)
        .values({
          groupId: input.groupId,
          kind: "expense",
          description,
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: input.splitMethod,
        })
        .returning({ id: expenses.id });
      expenseId = rows[0].id;
    }

    await db.insert(expensePayers).values(
      input.payers.map((p) => ({ expenseId: expenseId!, aliasId: p.aliasId, paidCents: p.paidCents }))
    );
    await db.insert(expenseShares).values(
      split.shares.map((s) => ({
        expenseId: expenseId!,
        aliasId: s.aliasId,
        owedCents: s.owedCents,
        splitValue: s.splitValue,
      }))
    );

    if (oldExpense) {
      const changes = buildExpenseChanges({
        oldExpense,
        oldPayers,
        oldShares,
        input,
        description,
        newShares: split.shares,
        aliasNames: new Map(groupAliases.map((a) => [a.id, a.name])),
      });
      if (changes.length > 0) {
        await logActivity(db, input.groupId, user, "expense.updated", {
          description,
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          changes,
        });
      }
    } else {
      await logActivity(db, input.groupId, user, "expense.added", {
        description,
        amountCents: input.amountCents,
        currency: input.currency,
        date: input.date,
      });
    }
    revalidateGroup(input.groupId);
    return { ok: true, id: expenseId };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSettlement(input: SettlementInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    await requireRole(db, input.groupId, user.id, "member");

    if (input.fromAliasId === input.toAliasId) {
      return { ok: false, error: "Payer and recipient must be different people." };
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: "Amount must be greater than zero." };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Unsupported currency." };
    if (!DATE_RE.test(input.date)) return { ok: false, error: "Invalid date." };

    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, input.groupId));
    const aliasIds = new Set(groupAliases.map((a) => a.id));
    if (!aliasIds.has(input.fromAliasId) || !aliasIds.has(input.toAliasId)) {
      return { ok: false, error: "Invalid participants." };
    }

    let expenseId = input.id;
    let oldSettlement: typeof expenses.$inferSelect | null = null;
    let oldFromId: string | null = null;
    let oldToId: string | null = null;
    if (expenseId) {
      const existing = await db
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Payment not found." };
      oldSettlement = existing[0];
      const [oldPayers, oldShares] = await Promise.all([
        db.select().from(expensePayers).where(eq(expensePayers.expenseId, expenseId)),
        db.select().from(expenseShares).where(eq(expenseShares.expenseId, expenseId)),
      ]);
      oldFromId = oldPayers[0]?.aliasId ?? null;
      oldToId = oldShares[0]?.aliasId ?? null;
      await db
        .update(expenses)
        .set({ amountCents: input.amountCents, currency: input.currency, date: input.date })
        .where(eq(expenses.id, expenseId));
      await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    } else {
      const rows = await db
        .insert(expenses)
        .values({
          groupId: input.groupId,
          kind: "settlement",
          description: "Payment",
          amountCents: input.amountCents,
          currency: input.currency,
          date: input.date,
          splitMethod: "exact",
        })
        .returning({ id: expenses.id });
      expenseId = rows[0].id;
    }

    await db.insert(expensePayers).values([
      { expenseId: expenseId!, aliasId: input.fromAliasId, paidCents: input.amountCents },
    ]);
    await db.insert(expenseShares).values([
      {
        expenseId: expenseId!,
        aliasId: input.toAliasId,
        owedCents: input.amountCents,
        splitValue: input.amountCents,
      },
    ]);

    const aliasNames = new Map(groupAliases.map((a) => [a.id, a.name]));
    const name = (id: string | null) => (id ? (aliasNames.get(id) ?? "?") : "?");
    const baseDetails = {
      fromName: name(input.fromAliasId),
      toName: name(input.toAliasId),
      amountCents: input.amountCents,
      currency: input.currency,
      date: input.date,
    };
    if (oldSettlement) {
      const changes: string[] = [];
      if (oldFromId !== input.fromAliasId) {
        changes.push(`payer ${name(oldFromId)} → ${name(input.fromAliasId)}`);
      }
      if (oldToId !== input.toAliasId) {
        changes.push(`recipient ${name(oldToId)} → ${name(input.toAliasId)}`);
      }
      if (oldSettlement.amountCents !== input.amountCents || oldSettlement.currency !== input.currency) {
        changes.push(
          `amount ${formatCents(oldSettlement.amountCents, oldSettlement.currency)} → ${formatCents(input.amountCents, input.currency)}`
        );
      }
      if (oldSettlement.date !== input.date) {
        changes.push(`date ${formatDate(oldSettlement.date)} → ${formatDate(input.date)}`);
      }
      if (changes.length > 0) {
        await logActivity(db, input.groupId, user, "payment.updated", { ...baseDetails, changes });
      }
    } else {
      await logActivity(db, input.groupId, user, "payment.added", baseDetails);
    }
    revalidateGroup(input.groupId);
    return { ok: true, id: expenseId };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteExpense(expenseId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db.select().from(expenses).where(eq(expenses.id, expenseId));
    const expense = rows[0];
    if (!expense) return { ok: false, error: "Expense not found." };
    await requireRole(db, expense.groupId, user.id, "member");

    // Capture the participants for the log before their rows disappear.
    let logDetails: Record<string, unknown>;
    if (expense.kind === "settlement") {
      const [payerRows, shareRows] = await Promise.all([
        db
          .select({ name: aliases.name })
          .from(expensePayers)
          .innerJoin(aliases, eq(expensePayers.aliasId, aliases.id))
          .where(eq(expensePayers.expenseId, expenseId)),
        db
          .select({ name: aliases.name })
          .from(expenseShares)
          .innerJoin(aliases, eq(expenseShares.aliasId, aliases.id))
          .where(eq(expenseShares.expenseId, expenseId)),
      ]);
      logDetails = {
        fromName: payerRows[0]?.name ?? "?",
        toName: shareRows[0]?.name ?? "?",
        amountCents: expense.amountCents,
        currency: expense.currency,
      };
    } else {
      logDetails = {
        description: expense.description,
        amountCents: expense.amountCents,
        currency: expense.currency,
      };
    }

    await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
    await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    await db.delete(expenses).where(eq(expenses.id, expenseId));
    await logActivity(
      db,
      expense.groupId,
      user,
      expense.kind === "settlement" ? "payment.deleted" : "expense.deleted",
      logDetails
    );
    revalidateGroup(expense.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- FX rates ----------

export async function updateRatesNow(): Promise<ActionResult> {
  try {
    await requireUser();
    await refreshRates();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

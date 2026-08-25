"use server";

import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, withTransaction, type Db } from "@/db";
import {
  activityLog,
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  fxRates,
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
import type { TFunc } from "@/lib/i18n";
import { getT } from "@/lib/i18n-server";
import { getMembership, loadCircle } from "@/lib/group-data";
import { mergeAliasReferences } from "@/lib/merge-alias";
import { RATE_LIMITS, rateLimit } from "@/lib/rate-limit";
import { inviteExpiry, inviteIsUsable, joinUrl, newInviteToken } from "@/lib/invites";
import { convertCents, isFixedLegPair } from "@/lib/rates";
import { refreshRates } from "@/lib/rates-fetch";
import { computeShares, validatePayers, SPLIT_METHODS } from "@/lib/split";
import type {
  ActionResult,
  ActivityEntryDto,
  ChangeFragment,
  CircleUserDto,
  ExpenseInput,
  InviteLinkDto,
  SettlementInput,
} from "@/lib/types";

/**
 * Refuse to store a transaction whose currency can't currently convert to the
 * group currency — fail loudly at entry instead of silently corrupting the
 * balances at display time. Fixed euro legs (HRK <-> EUR) always convert
 * and need no stored rates.
 */
async function currencyConversionError(
  db: Db,
  currency: string,
  groupCurrency: string,
  t: TFunc
): Promise<string | null> {
  if (currency === groupCurrency || isFixedLegPair(currency, groupCurrency)) return null;
  const latest = await db.select().from(fxRates).orderBy(desc(fxRates.date)).limit(1);
  const row = latest[0] ? { date: latest[0].date, rates: latest[0].rates } : null;
  if (convertCents(100, currency, groupCurrency, row) === null) {
    return t("errors.noRateForCurrency", { currency, groupCurrency });
  }
  return null;
}

/** Denormalized name-list snapshot for a paidBy/splitBetween fragment. The
 *  renderer shows the names, or "{count} people" when the list is long. */
function participantParams(ids: string[], names: Map<string, string>) {
  return { names: ids.slice(0, 8).map((id) => names.get(id) ?? "?"), count: ids.length };
}

/**
 * Machine-readable fragments describing what an expense edit changed, computed
 * against the rows as they were before the update. Stored as {key, params}
 * jsonb and rendered in the VIEWER's locale at display time (RFC 02 §3.3) —
 * never as pre-rendered prose. Distribution-only tweaks are reported
 * generically, and changes implied by an amount or method change are not
 * repeated.
 */
function buildExpenseChanges(params: {
  oldExpense: { description: string; amountCents: number; currency: string; date: string; splitMethod: string };
  oldPayers: { aliasId: string; paidCents: number }[];
  oldShares: { aliasId: string; owedCents: number }[];
  input: ExpenseInput;
  description: string;
  newShares: { aliasId: string; owedCents: number }[];
  aliasNames: Map<string, string>;
}): ChangeFragment[] {
  const { oldExpense, oldPayers, oldShares, input, description, newShares, aliasNames } = params;
  const changes: ChangeFragment[] = [];
  const amountChanged =
    oldExpense.amountCents !== input.amountCents || oldExpense.currency !== input.currency;
  const methodChanged = oldExpense.splitMethod !== input.splitMethod;

  if (oldExpense.description !== description) {
    changes.push({ key: "description", params: { from: oldExpense.description, to: description } });
  }
  if (amountChanged) {
    changes.push({
      key: "amount",
      params: {
        fromCents: oldExpense.amountCents,
        fromCurrency: oldExpense.currency,
        toCents: input.amountCents,
        toCurrency: input.currency,
      },
    });
  }
  if (oldExpense.date !== input.date) {
    changes.push({ key: "date", params: { from: oldExpense.date, to: input.date } });
  }
  if (methodChanged) {
    changes.push({
      key: "splitMethod",
      params: { from: oldExpense.splitMethod, to: input.splitMethod },
    });
  }

  const sortedIds = (ids: string[]) => [...ids].sort().join(",");
  const payerKey = (l: { aliasId: string; paidCents: number }[]) =>
    l.map((p) => `${p.aliasId}:${p.paidCents}`).sort().join(",");
  const oldPayerIds = oldPayers.map((p) => p.aliasId).sort();
  const newPayerIds = input.payers.map((p) => p.aliasId).sort();
  if (sortedIds(oldPayerIds) !== sortedIds(newPayerIds)) {
    changes.push({
      key: "paidBy",
      params: {
        from: participantParams(oldPayerIds, aliasNames),
        to: participantParams(newPayerIds, aliasNames),
      },
    });
  } else if (!amountChanged && payerKey(oldPayers) !== payerKey(input.payers)) {
    changes.push({ key: "payerAmountsAdjusted" });
  }

  const shareKey = (l: { aliasId: string; owedCents: number }[]) =>
    l.map((s) => `${s.aliasId}:${s.owedCents}`).sort().join(",");
  const oldShareIds = oldShares.map((s) => s.aliasId).sort();
  const newShareIds = newShares.map((s) => s.aliasId).sort();
  if (sortedIds(oldShareIds) !== sortedIds(newShareIds)) {
    changes.push({
      key: "splitBetween",
      params: {
        from: participantParams(oldShareIds, aliasNames),
        to: participantParams(newShareIds, aliasNames),
      },
    });
  } else if (!amountChanged && !methodChanged && shareKey(oldShares) !== shareKey(newShares)) {
    changes.push({ key: "splitAmountsAdjusted" });
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
    const t = await getT();
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: t("errors.groupNameRequired") };
    if (!isSupportedCurrency(currency)) return { ok: false, error: t("errors.unsupportedCurrency") };
    const db = await getDb();
    const groupId = await withTransaction(async (tx) => {
      const rows = await tx
        .insert(groups)
        .values({ userId: user.id, name: trimmed, currency })
        .returning({ id: groups.id });
      // The owner participates too — give them a linked alias from the start.
      await createLinkedAlias(tx, rows[0].id, user);
      return rows[0].id;
    });
    await logActivity(db, groupId, user, "group.created", { name: trimmed });
    revalidatePath("/");
    return { ok: true, id: groupId };
  } catch (e) {
    return fail(e);
  }
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; currency?: string; simplifyDebts?: boolean }
): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "owner");
    const set: Partial<typeof groups.$inferInsert> = {};
    if (patch.name !== undefined) {
      const trimmed = patch.name.trim();
      if (!trimmed) return { ok: false, error: t("errors.groupNameRequired") };
      set.name = trimmed;
    }
    if (patch.currency !== undefined) {
      if (!isSupportedCurrency(patch.currency)) return { ok: false, error: t("errors.unsupportedCurrency") };
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
    // remove transactions first, then aliases, then the group — atomically
    // and set-based, so a mid-flight failure can't leave a half-deleted group
    // and a large group doesn't take 2N round trips.
    await withTransaction(async (tx) => {
      const groupExpenseIds = tx
        .select({ id: expenses.id })
        .from(expenses)
        .where(eq(expenses.groupId, groupId));
      await tx.delete(expensePayers).where(inArray(expensePayers.expenseId, groupExpenseIds));
      await tx.delete(expenseShares).where(inArray(expenseShares.expenseId, groupExpenseIds));
      await tx.delete(expenses).where(eq(expenses.groupId, groupId));
      await tx.delete(aliases).where(eq(aliases.groupId, groupId));
      await tx.delete(groups).where(eq(groups.id, groupId));
    });
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
    const t = await getT();
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: t("errors.nameRequired") };
    const db = await getDb();
    await requireRole(db, groupId, user.id, "owner");
    const existing = await db.select().from(aliases).where(eq(aliases.groupId, groupId));
    if (existing.some((a) => a.name.toLowerCase() === trimmed.toLowerCase())) {
      return { ok: false, error: t("errors.alreadyInGroup", { name: trimmed }) };
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
  if (!alias) throw new Error((await getT())("errors.personNotFound"));
  await requireRole(db, alias.groupId, userId, "owner");
  return alias;
}

export async function renameAlias(aliasId: string, name: string): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: t("errors.nameRequired") };
    const db = await getDb();
    const rows = await db.select().from(aliases).where(eq(aliases.id, aliasId));
    const alias = rows[0];
    if (!alias) return { ok: false, error: t("errors.personNotFound") };
    // The owner renames anyone in their group; a member renames only the
    // participant linked to their own account.
    const { role } = await requireRole(db, alias.groupId, user.id, "member");
    if (role !== "owner" && alias.userId !== user.id) {
      return { ok: false, error: t("errors.onlyRenameSelf") };
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
    const t = await getT();
    const alias = await requireAliasInOwnedGroup(db, aliasId, user.id);
    if (alias.userId) {
      return { ok: false, error: t("errors.personIsMember") };
    }
    const [paid, owed] = await Promise.all([
      db.select({ id: expensePayers.expenseId }).from(expensePayers).where(eq(expensePayers.aliasId, aliasId)).limit(1),
      db.select({ id: expenseShares.expenseId }).from(expenseShares).where(eq(expenseShares.aliasId, aliasId)).limit(1),
    ]);
    if (paid.length > 0 || owed.length > 0) {
      return {
        ok: false,
        error: t("errors.personInExpenses", { name: alias.name }),
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
    const t = await getT();
    const alias = await requireAliasInOwnedGroup(db, aliasId, user.id);
    if (alias.userId) {
      return { ok: false, error: t("errors.alreadyLinked") };
    }
    const membership = await getMembership(db, alias.groupId, targetUserId);
    if (!membership) {
      return { ok: false, error: t("errors.notAMember") };
    }
    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, alias.groupId));
    const existing = groupAliases.find((a) => a.userId === targetUserId);
    // Atomic: a partial merge would corrupt both identities' histories.
    await withTransaction(async (tx) => {
      if (existing) {
        await mergeAliasReferences(tx, existing.id, alias.id);
        await tx.delete(aliases).where(eq(aliases.id, existing.id));
      }
      await tx.update(aliases).set({ userId: targetUserId }).where(eq(aliases.id, alias.id));
    });
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
      return { ok: false, error: (await getT())("errors.ownerCannotBeRemoved") };
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
      return { ok: false, error: (await getT())("errors.ownerCannotLeave") };
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
    const t = await getT();
    await requireRole(db, groupId, user.id, "owner");
    const circle = await loadCircle(user.id);
    if (!circle.some((c) => c.userId === targetUserId)) {
      return { ok: false, error: t("errors.onlyAddCircle") };
    }
    const targetRows = await db.select().from(users).where(eq(users.id, targetUserId));
    const target = targetRows[0];
    if (!target) return { ok: false, error: t("errors.accountNotFound") };
    await joinGroup(groupId, {
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

async function joinGroup(groupId: string, user: SessionUser) {
  // Atomic: a membership row without a linked alias would leave the joiner
  // half-present (listed as a member but absent from every split picker).
  await withTransaction(async (tx) => {
    await tx
      .insert(groupMembers)
      .values({ groupId, userId: user.id })
      .onConflictDoNothing();
    await createLinkedAlias(tx, groupId, user);
  });
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
    if (!invite) return { ok: false, error: (await getT())("errors.inviteNotFound") };
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
    const t = await getT();
    // Token-guessing ceiling; legitimate users accept a handful per hour at most.
    const rl = await rateLimit(db, `invite:${user.id}`, RATE_LIMITS.invitePerUser);
    if (!rl.ok) return { ok: false, error: t("errors.tooManyRequests", { seconds: rl.retryAfterSec }) };

    const rows = await db.select().from(groupInvites).where(eq(groupInvites.token, token));
    const invite = rows[0];
    if (!invite) return { ok: false, error: t("errors.inviteInvalid") };

    const membership = await getMembership(db, invite.groupId, user.id);
    if (membership) return { ok: true, id: invite.groupId };
    if (!inviteIsUsable(invite)) {
      return { ok: false, error: t("errors.inviteExpired") };
    }

    await joinGroup(invite.groupId, user);
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
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, input.groupId, user.id, "member");
    const rl = await rateLimit(db, `write:${user.id}`, RATE_LIMITS.writePerUser);
    if (!rl.ok) return { ok: false, error: t("errors.tooManyRequests", { seconds: rl.retryAfterSec }) };

    const description = input.description.trim();
    if (!description) return { ok: false, error: t("errors.descriptionRequired") };
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: t("splitError.amountGreaterZero") };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: t("errors.unsupportedCurrency") };
    if (!DATE_RE.test(input.date)) return { ok: false, error: t("errors.invalidDate") };
    if (!SPLIT_METHODS.includes(input.splitMethod)) return { ok: false, error: t("errors.invalidSplitMethod") };
    const currencyError = await currencyConversionError(db, input.currency, group.currency, t);
    if (currencyError) return { ok: false, error: currencyError };

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
      return { ok: false, error: t("errors.invalidParticipants") };
    }

    const payerError = validatePayers(input.amountCents, input.payers, input.currency, t);
    if (payerError) return { ok: false, error: payerError };

    const split = computeShares(input.splitMethod, input.amountCents, input.splits, input.currency, t);
    if (!split.ok) return { ok: false, error: split.error };

    // Everything that mutates runs in one transaction: a mid-flight failure
    // must never leave an expense stripped of its payers/shares (the balance
    // math would then silently skip it).
    const txResult = await withTransaction<{ error: string } | { expenseId: string }>(
      async (tx) => {
        let expenseId = input.id;
        let oldExpense: typeof expenses.$inferSelect | null = null;
        let oldPayers: { aliasId: string; paidCents: number }[] = [];
        let oldShares: { aliasId: string; owedCents: number }[] = [];
        if (expenseId) {
          const existing = await tx
            .select()
            .from(expenses)
            .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
          if (!existing[0]) return { error: t("errors.expenseNotFound") };
          oldExpense = existing[0];
          [oldPayers, oldShares] = await Promise.all([
            tx.select().from(expensePayers).where(eq(expensePayers.expenseId, expenseId)),
            tx.select().from(expenseShares).where(eq(expenseShares.expenseId, expenseId)),
          ]);
          await tx
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
          await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
          await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
        } else {
          const rows = await tx
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

        await tx.insert(expensePayers).values(
          input.payers.map((p) => ({ expenseId: expenseId!, aliasId: p.aliasId, paidCents: p.paidCents }))
        );
        await tx.insert(expenseShares).values(
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
            await logActivity(tx, input.groupId, user, "expense.updated", {
              description,
              amountCents: input.amountCents,
              currency: input.currency,
              date: input.date,
              changes,
            });
          }
        } else {
          await logActivity(tx, input.groupId, user, "expense.added", {
            description,
            amountCents: input.amountCents,
            currency: input.currency,
            date: input.date,
          });
        }
        return { expenseId: expenseId! };
      }
    );
    if ("error" in txResult) return { ok: false, error: txResult.error };
    revalidateGroup(input.groupId);
    return { ok: true, id: txResult.expenseId };
  } catch (e) {
    return fail(e);
  }
}

export async function saveSettlement(input: SettlementInput): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, input.groupId, user.id, "member");
    const rl = await rateLimit(db, `write:${user.id}`, RATE_LIMITS.writePerUser);
    if (!rl.ok) return { ok: false, error: t("errors.tooManyRequests", { seconds: rl.retryAfterSec }) };

    if (input.fromAliasId === input.toAliasId) {
      return { ok: false, error: t("settle.differentPeople") };
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      return { ok: false, error: t("splitError.amountGreaterZero") };
    }
    if (!isSupportedCurrency(input.currency)) return { ok: false, error: t("errors.unsupportedCurrency") };
    if (!DATE_RE.test(input.date)) return { ok: false, error: t("errors.invalidDate") };
    const currencyError = await currencyConversionError(db, input.currency, group.currency, t);
    if (currencyError) return { ok: false, error: currencyError };

    const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, input.groupId));
    const aliasIds = new Set(groupAliases.map((a) => a.id));
    if (!aliasIds.has(input.fromAliasId) || !aliasIds.has(input.toAliasId)) {
      return { ok: false, error: t("errors.invalidParticipants") };
    }

    const txResult = await withTransaction<{ error: string } | { expenseId: string }>(
      async (tx) => {
        let expenseId = input.id;
        let oldSettlement: typeof expenses.$inferSelect | null = null;
        let oldFromId: string | null = null;
        let oldToId: string | null = null;
        if (expenseId) {
          const existing = await tx
            .select()
            .from(expenses)
            .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
          if (!existing[0]) return { error: t("errors.paymentNotFound") };
          oldSettlement = existing[0];
          const [oldPayers, oldShares] = await Promise.all([
            tx.select().from(expensePayers).where(eq(expensePayers.expenseId, expenseId)),
            tx.select().from(expenseShares).where(eq(expenseShares.expenseId, expenseId)),
          ]);
          oldFromId = oldPayers[0]?.aliasId ?? null;
          oldToId = oldShares[0]?.aliasId ?? null;
          await tx
            .update(expenses)
            .set({ amountCents: input.amountCents, currency: input.currency, date: input.date })
            .where(eq(expenses.id, expenseId));
          await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
          await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
        } else {
          const rows = await tx
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

        await tx.insert(expensePayers).values([
          { expenseId: expenseId!, aliasId: input.fromAliasId, paidCents: input.amountCents },
        ]);
        await tx.insert(expenseShares).values([
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
          const changes: ChangeFragment[] = [];
          if (oldFromId !== input.fromAliasId) {
            changes.push({ key: "payer", params: { from: name(oldFromId), to: name(input.fromAliasId) } });
          }
          if (oldToId !== input.toAliasId) {
            changes.push({ key: "recipient", params: { from: name(oldToId), to: name(input.toAliasId) } });
          }
          if (oldSettlement.amountCents !== input.amountCents || oldSettlement.currency !== input.currency) {
            changes.push({
              key: "amount",
              params: {
                fromCents: oldSettlement.amountCents,
                fromCurrency: oldSettlement.currency,
                toCents: input.amountCents,
                toCurrency: input.currency,
              },
            });
          }
          if (oldSettlement.date !== input.date) {
            changes.push({ key: "date", params: { from: oldSettlement.date, to: input.date } });
          }
          if (changes.length > 0) {
            await logActivity(tx, input.groupId, user, "payment.updated", { ...baseDetails, changes });
          }
        } else {
          await logActivity(tx, input.groupId, user, "payment.added", baseDetails);
        }
        return { expenseId: expenseId! };
      }
    );
    if ("error" in txResult) return { ok: false, error: txResult.error };
    revalidateGroup(input.groupId);
    return { ok: true, id: txResult.expenseId };
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
    if (!expense) return { ok: false, error: (await getT())("errors.expenseNotFound") };
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

    await withTransaction(async (tx) => {
      await tx.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
      await tx.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
      await tx.delete(expenses).where(eq(expenses.id, expenseId));
      await logActivity(
        tx,
        expense.groupId,
        user,
        expense.kind === "settlement" ? "payment.deleted" : "expense.deleted",
        logDetails
      );
    });
    revalidateGroup(expense.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ---------- FX rates ----------

export async function updateRatesNow(): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();
    const db = await getDb();
    // Global cooldown first (rates change once a day — a refresh 10 minutes
    // ago is as fresh as it gets), then a per-user ceiling.
    const globalRl = await rateLimit(db, "rates:global", RATE_LIMITS.ratesGlobal);
    if (!globalRl.ok) return { ok: false, error: t("errors.ratesRecentlyUpdated") };
    const userRl = await rateLimit(db, `rates:${user.id}`, RATE_LIMITS.ratesPerUser);
    if (!userRl.ok) {
      return { ok: false, error: t("errors.tooManyRequests", { seconds: userRl.retryAfterSec }) };
    }
    await refreshRates();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

"use server";

import { and, eq, gt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { getDb, type Db } from "@/db";
import {
  aliases,
  expensePayers,
  expenseShares,
  expenses,
  groupInvites,
  groupMembers,
  groups,
  users,
} from "@/db/schema";
import { isSupportedCurrency } from "@/lib/currencies";
import { sendInviteEmail } from "@/lib/email";
import { getMembership, loadCircle } from "@/lib/group-data";
import { inviteExpiry, inviteIsUsable, joinUrl, newInviteToken } from "@/lib/invites";
import { refreshRates } from "@/lib/rates-fetch";
import { computeShares, validatePayers, SPLIT_METHODS } from "@/lib/split";
import type {
  ActionResult,
  CircleUserDto,
  ExpenseInput,
  GroupRole,
  InviteEmailResult,
  InvitesDto,
  SettlementInput,
} from "@/lib/types";

type SessionUser = { id: string; email: string; name: string };

async function requireUser(): Promise<SessionUser> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) throw new Error("Not signed in.");
  return { id: user.id, email: user.email, name: user.name ?? user.email };
}

/** Membership gate: "member" allows both roles, "owner" only the owner. */
async function requireRole(db: Db, groupId: string, userId: string, minRole: GroupRole) {
  const membership = await getMembership(db, groupId, userId);
  if (!membership) throw new Error("Group not found.");
  if (minRole === "owner" && membership.role !== "owner") {
    throw new Error("Only the group owner can do that.");
  }
  return membership;
}

function fail(error: unknown): { ok: false; error: string } {
  return { ok: false, error: error instanceof Error ? error.message : "Something went wrong." };
}

function revalidateGroup(groupId: string) {
  revalidatePath("/");
  revalidatePath(`/groups/${groupId}`);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_ANONYMOUS_MESSAGE =
  "If an account with this email exists, they will receive an invite.";

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
    await requireRole(db, groupId, user.id, "owner");
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
    const alias = await requireAliasInOwnedGroup(db, aliasId, user.id);
    await db.update(aliases).set({ name: trimmed }).where(eq(aliases.id, aliasId));
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

/**
 * Invite by email. Deliberately anonymous: the invite row is created and the
 * email is (best-effort) sent whether or not an account exists, and the
 * response message is always the same — nothing here reveals whether the
 * address belongs to an account. The one exception: someone in the owner's
 * circle is added directly (their existence is already known to the owner).
 */
export async function inviteByEmail(groupId: string, rawEmail: string): Promise<InviteEmailResult> {
  try {
    const user = await requireUser();
    const email = rawEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, error: "Enter a valid email address." };
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "owner");

    if (email === user.email.toLowerCase()) {
      return { ok: false, error: "That's your own email address." };
    }

    // Already a member? The owner can see the member list, so a real answer
    // here leaks nothing.
    const memberEmails = await db
      .select({ email: users.email })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId));
    if (memberEmails.some((m) => m.email.toLowerCase() === email)) {
      return { ok: false, error: "This person is already a member of the group." };
    }

    // Circle accounts join immediately.
    const circle = await loadCircle(user.id);
    const inCircle = circle.find((c) => c.email.toLowerCase() === email);
    if (inCircle) {
      await joinGroup(db, groupId, { id: inCircle.userId, email: inCircle.email, name: inCircle.name });
      revalidateGroup(groupId);
      return { ok: true, joined: true, message: `${inCircle.name} is in your circle and was added directly.` };
    }

    // Reuse a still-active invite for this address, otherwise create one.
    const existing = await db
      .select()
      .from(groupInvites)
      .where(
        and(
          eq(groupInvites.groupId, groupId),
          eq(groupInvites.kind, "email"),
          eq(groupInvites.email, email),
          eq(groupInvites.status, "active"),
          gt(groupInvites.expiresAt, new Date())
        )
      );
    let token = existing[0]?.token;
    if (token) {
      await db
        .update(groupInvites)
        .set({ expiresAt: inviteExpiry() })
        .where(eq(groupInvites.id, existing[0].id));
    } else {
      // Spam guard: bound how many outstanding email invites (and therefore
      // outgoing emails to new addresses) a single group can have.
      const active = await db
        .select({ id: groupInvites.id })
        .from(groupInvites)
        .where(
          and(
            eq(groupInvites.groupId, groupId),
            eq(groupInvites.kind, "email"),
            eq(groupInvites.status, "active"),
            gt(groupInvites.expiresAt, new Date())
          )
        );
      if (active.length >= 20) {
        return {
          ok: false,
          error: "This group has too many pending invites. Revoke some before sending more.",
        };
      }
      token = newInviteToken();
      await db.insert(groupInvites).values({
        groupId,
        kind: "email",
        token,
        email,
        createdBy: user.id,
        expiresAt: inviteExpiry(),
      });
    }
    await sendInviteEmail({
      to: email,
      groupName: group.name,
      inviterName: user.name,
      url: joinUrl(token),
    });
    revalidateGroup(groupId);
    return { ok: true, joined: false, message: INVITE_ANONYMOUS_MESSAGE };
  } catch (e) {
    return fail(e);
  }
}

export async function getInvites(groupId: string): Promise<InvitesDto> {
  const user = await requireUser();
  const db = await getDb();
  await requireRole(db, groupId, user.id, "owner");
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
  const link = rows.find((r) => r.kind === "link");
  return {
    link: link
      ? { id: link.id, url: joinUrl(link.token), expiresAt: link.expiresAt.toISOString().slice(0, 10) }
      : null,
    emailInvites: rows
      .filter((r) => r.kind === "email")
      .map((r) => ({ id: r.id, email: r.email ?? "", expiresAt: r.expiresAt.toISOString().slice(0, 10) })),
  };
}

/** Return the existing active invite link, or create a fresh 7-day one. */
export async function createInviteLink(groupId: string): Promise<InvitesDto["link"]> {
  const user = await requireUser();
  const db = await getDb();
  await requireRole(db, groupId, user.id, "owner");
  const existing = await db
    .select()
    .from(groupInvites)
    .where(
      and(
        eq(groupInvites.groupId, groupId),
        eq(groupInvites.kind, "link"),
        eq(groupInvites.status, "active"),
        gt(groupInvites.expiresAt, new Date())
      )
    );
  if (existing[0]) {
    return {
      id: existing[0].id,
      url: joinUrl(existing[0].token),
      expiresAt: existing[0].expiresAt.toISOString().slice(0, 10),
    };
  }
  const token = newInviteToken();
  const rows = await db
    .insert(groupInvites)
    .values({ groupId, kind: "link", token, createdBy: user.id, expiresAt: inviteExpiry() })
    .returning();
  return { id: rows[0].id, url: joinUrl(token), expiresAt: rows[0].expiresAt.toISOString().slice(0, 10) };
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
    if (membership) {
      if (invite.kind === "email" && invite.email === user.email.toLowerCase() && invite.status === "active") {
        await db.update(groupInvites).set({ status: "accepted" }).where(eq(groupInvites.id, invite.id));
      }
      return { ok: true, id: invite.groupId };
    }
    if (!inviteIsUsable(invite)) {
      return { ok: false, error: "This invite has expired. Ask for a new one." };
    }
    if (invite.kind === "email" && invite.email !== user.email.toLowerCase()) {
      return { ok: false, error: "This invite was sent to a different email address." };
    }

    await joinGroup(db, invite.groupId, user);
    if (invite.kind === "email") {
      await db.update(groupInvites).set({ status: "accepted" }).where(eq(groupInvites.id, invite.id));
    }
    revalidateGroup(invite.groupId);
    return { ok: true, id: invite.groupId };
  } catch (e) {
    return fail(e);
  }
}

export async function declineInvite(token: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db.select().from(groupInvites).where(eq(groupInvites.token, token));
    const invite = rows[0];
    if (invite && invite.kind === "email" && invite.email === user.email.toLowerCase()) {
      await db.update(groupInvites).set({ status: "declined" }).where(eq(groupInvites.id, invite.id));
      revalidatePath("/");
    }
    return { ok: true };
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
    if (expenseId) {
      const existing = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Expense not found." };
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
    if (expenseId) {
      const existing = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, expenseId), eq(expenses.groupId, input.groupId)));
      if (!existing[0]) return { ok: false, error: "Payment not found." };
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
    await db.delete(expensePayers).where(eq(expensePayers.expenseId, expenseId));
    await db.delete(expenseShares).where(eq(expenseShares.expenseId, expenseId));
    await db.delete(expenses).where(eq(expenses.id, expenseId));
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

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/db";
import {
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
import { inviteIsUsable } from "./invites";
import { allocateByWeights } from "./money";
import { convertCents, findRateRow, ratesAreStale, todayString, type FxRow } from "./rates";
import { netBalances, pairwiseDebts, simplifiedDebts, type BalanceTransaction } from "./simplify";
import type { SplitMethod } from "./split";
import type {
  CircleUserDto,
  ExpenseDto,
  GroupDto,
  GroupRole,
  GroupSummary,
  JoinPreview,
} from "./types";

type GroupRow = typeof groups.$inferSelect;

/** The caller's role in a group, or null when they have no access. */
export async function getMembership(
  db: Db,
  groupId: string,
  userId: string
): Promise<{ group: GroupRow; role: GroupRole } | null> {
  const groupRows = await db.select().from(groups).where(eq(groups.id, groupId));
  const group = groupRows[0];
  if (!group) return null;
  if (group.userId === userId) return { group, role: "owner" };
  const memberRows = await db
    .select()
    .from(groupMembers)
    .where(and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)));
  return memberRows[0] ? { group, role: "member" } : null;
}

export async function loadGroupSummaries(userId: string): Promise<GroupSummary[]> {
  const db = await getDb();
  const [owned, joined] = await Promise.all([
    db.select().from(groups).where(eq(groups.userId, userId)),
    db
      .select({ group: groups })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(eq(groupMembers.userId, userId)),
  ]);
  const rows: { group: GroupRow; role: GroupRole }[] = [
    ...owned.map((group) => ({ group, role: "owner" as const })),
    ...joined.map((r) => ({ group: r.group, role: "member" as const })),
  ].sort((a, b) => b.group.createdAt.getTime() - a.group.createdAt.getTime());
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.group.id);
  const [aliasCounts, expenseCounts, memberCounts] = await Promise.all([
    db
      .select({ groupId: aliases.groupId, count: sql<number>`count(*)::int` })
      .from(aliases)
      .where(inArray(aliases.groupId, ids))
      .groupBy(aliases.groupId),
    db
      .select({ groupId: expenses.groupId, count: sql<number>`count(*)::int` })
      .from(expenses)
      .where(inArray(expenses.groupId, ids))
      .groupBy(expenses.groupId),
    db
      .select({ groupId: groupMembers.groupId, count: sql<number>`count(*)::int` })
      .from(groupMembers)
      .where(inArray(groupMembers.groupId, ids))
      .groupBy(groupMembers.groupId),
  ]);
  const aliasMap = new Map(aliasCounts.map((r) => [r.groupId, r.count]));
  const expenseMap = new Map(expenseCounts.map((r) => [r.groupId, r.count]));
  const memberMap = new Map(memberCounts.map((r) => [r.groupId, r.count]));

  return rows.map(({ group, role }) => ({
    id: group.id,
    name: group.name,
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    aliasCount: aliasMap.get(group.id) ?? 0,
    expenseCount: expenseMap.get(group.id) ?? 0,
    memberCount: (memberMap.get(group.id) ?? 0) + 1, // + owner
    role,
  }));
}

export async function loadGroupData(groupId: string, userId: string): Promise<GroupDto | null> {
  const db = await getDb();
  const membership = await getMembership(db, groupId, userId);
  if (!membership) return null;
  const { group } = membership;

  const [aliasRows, expenseRows, fxRowsRaw, memberRows, ownerRows] = await Promise.all([
    db.select().from(aliases).where(eq(aliases.groupId, groupId)).orderBy(asc(aliases.createdAt)),
    db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.date), desc(expenses.createdAt)),
    db.select().from(fxRates).orderBy(asc(fxRates.date)),
    db
      .select({ user: users })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId)),
    db.select().from(users).where(eq(users.id, group.userId)),
  ]);

  const expenseIds = expenseRows.map((e) => e.id);
  const [payerRows, shareRows] =
    expenseIds.length > 0
      ? await Promise.all([
          db.select().from(expensePayers).where(inArray(expensePayers.expenseId, expenseIds)),
          db.select().from(expenseShares).where(inArray(expenseShares.expenseId, expenseIds)),
        ])
      : [[], []];

  const fxRows: FxRow[] = fxRowsRaw.map((r) => ({ date: r.date, rates: r.rates }));

  const expenseDtos: ExpenseDto[] = expenseRows.map((e) => {
    const needsConversion = e.currency !== group.currency;
    const rateRow = needsConversion ? findRateRow(fxRows, e.date) : null;
    const convertedCents = needsConversion
      ? convertCents(e.amountCents, e.currency, group.currency, rateRow)
      : e.amountCents;
    return {
      id: e.id,
      kind: e.kind === "settlement" ? "settlement" : "expense",
      description: e.description,
      amountCents: e.amountCents,
      currency: e.currency,
      date: e.date,
      splitMethod: e.splitMethod as SplitMethod,
      payers: payerRows
        .filter((p) => p.expenseId === e.id)
        .map((p) => ({ aliasId: p.aliasId, paidCents: p.paidCents })),
      shares: shareRows
        .filter((s) => s.expenseId === e.id)
        .map((s) => ({ aliasId: s.aliasId, owedCents: s.owedCents, splitValue: s.splitValue })),
      convertedCents,
      rateDate: needsConversion ? (rateRow?.date ?? null) : null,
    };
  });

  // Balance math runs entirely in the group currency. To keep sums exact after
  // conversion, the converted total is re-allocated across payers and shares
  // proportionally to their original amounts (instead of converting each part
  // independently, which can drift by a cent).
  const transactions: BalanceTransaction[] = [];
  for (const e of expenseDtos) {
    if (e.convertedCents === null || e.payers.length === 0 || e.shares.length === 0) continue;
    const payerCents = allocateByWeights(e.convertedCents, e.payers.map((p) => p.paidCents));
    const shareCents = allocateByWeights(e.convertedCents, e.shares.map((s) => s.owedCents));
    transactions.push({
      payers: e.payers.map((p, i) => ({ aliasId: p.aliasId, cents: payerCents[i] })),
      shares: e.shares.map((s, i) => ({ aliasId: s.aliasId, cents: shareCents[i] })),
    });
  }

  const net = netBalances(transactions);
  const latestDate = fxRows.at(-1)?.date ?? null;
  const needsConversion = expenseDtos.some((e) => e.currency !== group.currency);

  const memberUsers = [
    ...(ownerRows[0] ? [ownerRows[0]] : []),
    ...memberRows.map((r) => r.user),
  ];
  const members = memberUsers.map((u) => ({
    userId: u.id,
    name: u.name ?? u.email,
    email: u.email,
    isOwner: u.id === group.userId,
    aliasId: aliasRows.find((a) => a.userId === u.id)?.id ?? null,
  }));

  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    myRole: membership.role,
    members,
    aliases: aliasRows.map((a) => ({ id: a.id, name: a.name, userId: a.userId })),
    expenses: expenseDtos,
    netBalances: Object.fromEntries(net),
    pairwiseDebts: pairwiseDebts(transactions),
    simplifiedDebts: simplifiedDebts(transactions),
    rates: {
      latestDate,
      stale: ratesAreStale(latestDate, todayString()),
      needsConversion,
      missingRate: expenseDtos.some((e) => e.convertedCents === null),
    },
  };
}

/**
 * Accounts the user already shares a group with ("circle"): owners and members
 * of every group the user owns or has joined, excluding the user themself.
 */
export async function loadCircle(userId: string): Promise<CircleUserDto[]> {
  const db = await getDb();
  const [owned, joined] = await Promise.all([
    db.select({ id: groups.id }).from(groups).where(eq(groups.userId, userId)),
    db.select({ id: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, userId)),
  ]);
  const groupIds = [...new Set([...owned, ...joined].map((r) => r.id))];
  if (groupIds.length === 0) return [];

  const [owners, members] = await Promise.all([
    db
      .select({ user: users })
      .from(groups)
      .innerJoin(users, eq(groups.userId, users.id))
      .where(inArray(groups.id, groupIds)),
    db
      .select({ user: users })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(inArray(groupMembers.groupId, groupIds)),
  ]);
  const seen = new Map<string, CircleUserDto>();
  for (const { user } of [...owners, ...members]) {
    if (user.id === userId) continue;
    seen.set(user.id, { userId: user.id, name: user.name ?? user.email, email: user.email });
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Everything the /join/[token] page needs to render, permission-checked. */
export async function loadInvitePreview(token: string, userId: string): Promise<JoinPreview> {
  const db = await getDb();
  const inviteRows = await db.select().from(groupInvites).where(eq(groupInvites.token, token));
  const invite = inviteRows[0];
  if (!invite) return { state: "invalid" };

  const membership = await getMembership(db, invite.groupId, userId);
  if (membership) return { state: "member", groupId: invite.groupId };
  if (!inviteIsUsable(invite)) return { state: "expired" };

  const [groupRows, inviterRows, aliasCount] = await Promise.all([
    db.select().from(groups).where(eq(groups.id, invite.groupId)),
    db.select().from(users).where(eq(users.id, invite.createdBy)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aliases)
      .where(eq(aliases.groupId, invite.groupId)),
  ]);
  if (!groupRows[0]) return { state: "invalid" };
  return {
    state: "ok",
    groupId: invite.groupId,
    groupName: groupRows[0].name,
    inviterName: inviterRows[0] ? (inviterRows[0].name ?? inviterRows[0].email) : "Someone",
    peopleCount: aliasCount[0]?.count ?? 0,
  };
}

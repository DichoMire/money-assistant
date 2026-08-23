import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, expensePayers, expenseShares, expenses, fxRates, groups } from "@/db/schema";
import { allocateByWeights } from "./money";
import { convertCents, findRateRow, ratesAreStale, todayString, type FxRow } from "./rates";
import { netBalances, pairwiseDebts, simplifiedDebts, type BalanceTransaction } from "./simplify";
import type { SplitMethod } from "./split";
import type { ExpenseDto, GroupDto, GroupSummary } from "./types";

export async function loadGroupSummaries(userId: string): Promise<GroupSummary[]> {
  const db = await getDb();
  const groupRows = await db
    .select()
    .from(groups)
    .where(eq(groups.userId, userId))
    .orderBy(desc(groups.createdAt));
  if (groupRows.length === 0) return [];

  const ids = groupRows.map((g) => g.id);
  const [aliasCounts, expenseCounts] = await Promise.all([
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
  ]);
  const aliasMap = new Map(aliasCounts.map((r) => [r.groupId, r.count]));
  const expenseMap = new Map(expenseCounts.map((r) => [r.groupId, r.count]));

  return groupRows.map((g) => ({
    id: g.id,
    name: g.name,
    currency: g.currency,
    simplifyDebts: g.simplifyDebts,
    aliasCount: aliasMap.get(g.id) ?? 0,
    expenseCount: expenseMap.get(g.id) ?? 0,
  }));
}

export async function loadGroupData(groupId: string, userId: string): Promise<GroupDto | null> {
  const db = await getDb();
  const groupRows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.userId, userId)));
  const group = groupRows[0];
  if (!group) return null;

  const [aliasRows, expenseRows, fxRowsRaw] = await Promise.all([
    db.select().from(aliases).where(eq(aliases.groupId, groupId)).orderBy(asc(aliases.createdAt)),
    db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, groupId))
      .orderBy(desc(expenses.date), desc(expenses.createdAt)),
    db.select().from(fxRates).orderBy(asc(fxRates.date)),
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

  return {
    id: group.id,
    name: group.name,
    currency: group.currency,
    simplifyDebts: group.simplifyDebts,
    aliases: aliasRows.map((a) => ({ id: a.id, name: a.name })),
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

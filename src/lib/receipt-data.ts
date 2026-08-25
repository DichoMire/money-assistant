import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { aliases, receiptItemShares, receiptItems, receiptScanImages, receiptScans } from "@/db/schema";
import { ASSIGN_MODES, type AssignMode } from "./receipt-convert";
import type { ScanDetailDto, ScanItemDto, ScanSummaryDto } from "./types";

/**
 * Read path for receipt scans (pages call these directly, like group-data.ts).
 * Membership checks stay in the callers, which already guard via loadGroupData.
 */

export async function loadScanList(groupId: string): Promise<ScanSummaryDto[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(receiptScans)
    .where(eq(receiptScans.groupId, groupId))
    .orderBy(desc(receiptScans.createdAt));
  if (rows.length === 0) return [];

  const counts = await db
    .select({ scanId: receiptItems.scanId, count: sql<number>`count(*)::int` })
    .from(receiptItems)
    .where(inArray(receiptItems.scanId, rows.map((r) => r.id)))
    .groupBy(receiptItems.scanId);
  const countMap = new Map(counts.map((c) => [c.scanId, c.count]));

  return rows.map((r) => ({
    id: r.id,
    merchant: r.merchant,
    date: r.date,
    currency: r.currency,
    totalCents: r.totalCents,
    itemCount: countMap.get(r.id) ?? 0,
    reconciles: r.reconciles,
    expenseId: r.expenseId,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function loadScanDetail(
  groupId: string,
  scanId: string
): Promise<ScanDetailDto | null> {
  const db = await getDb();
  const scanRows = await db.select().from(receiptScans).where(eq(receiptScans.id, scanId));
  const scan = scanRows[0];
  if (!scan || scan.groupId !== groupId) return null;

  const [itemRows, aliasRows, imageRows] = await Promise.all([
    db
      .select()
      .from(receiptItems)
      .where(eq(receiptItems.scanId, scanId))
      .orderBy(asc(receiptItems.position)),
    db.select({ id: aliases.id }).from(aliases).where(eq(aliases.groupId, groupId)),
    db
      .select({ scanId: receiptScanImages.scanId })
      .from(receiptScanImages)
      .where(eq(receiptScanImages.scanId, scanId)),
  ]);
  const liveAliasIds = new Set(aliasRows.map((a) => a.id));

  const shareRows =
    itemRows.length > 0
      ? await db
          .select()
          .from(receiptItemShares)
          .where(inArray(receiptItemShares.itemId, itemRows.map((i) => i.id)))
      : [];

  const items: ScanItemDto[] = itemRows.map((item) => {
    // Belt-and-braces: alias deletion cascades share rows away, but filter
    // against live aliases anyway so a stale row can never reach the UI.
    const shares = shareRows
      .filter((s) => s.itemId === item.id && liveAliasIds.has(s.aliasId))
      .map((s) => ({ aliasId: s.aliasId, exactCents: s.exactCents, units: s.units }));
    const mode = ASSIGN_MODES.includes(item.assignMode as AssignMode)
      ? (item.assignMode as AssignMode)
      : "unassigned";
    return {
      id: item.id,
      position: item.position,
      rawText: item.rawText,
      name: item.name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
      category: item.category,
      // An assignment whose people vanished reverts to unassigned, which
      // re-triggers the convert gate instead of silently dropping money.
      assignMode: shares.length === 0 && mode !== "unassigned" ? "unassigned" : mode,
      shares,
    };
  });

  return {
    id: scan.id,
    groupId: scan.groupId,
    status: scan.status,
    merchant: scan.merchant,
    date: scan.date,
    currency: scan.currency,
    subtotalCents: scan.subtotalCents,
    taxCents: scan.taxCents,
    tipCents: scan.tipCents,
    discountsCents: scan.discountsCents,
    discountPercentBp: scan.discountPercentBp,
    totalCents: scan.totalCents,
    confidence: scan.confidence,
    reconciles: scan.reconciles,
    model: scan.model,
    expenseId: scan.expenseId,
    hasImage: imageRows.length > 0,
    keepImage: scan.keepImage,
    items,
    createdAt: scan.createdAt.toISOString(),
  };
}

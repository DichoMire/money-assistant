"use server";

import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, type Db } from "@/db";
import { aliases, expenses, receiptItemShares, receiptItems, receiptScanImages, receiptScans } from "@/db/schema";
import {
  fail,
  DATE_RE,
  logActivity,
  requireRole,
  requireUser,
  type SessionUser,
} from "@/lib/action-helpers";
import { isSupportedCurrency } from "@/lib/currencies";
import {
  ASSIGN_MODES,
  buildExpenseInput,
  computePersonTotals,
  type ConvertItem,
} from "@/lib/receipt-convert";
import { parseReceiptImage } from "@/lib/receipt-parse";
import { MAX_RECEIPT_ITEMS, reconcile } from "@/lib/receipt-schema";
import { todayString } from "@/lib/rates";
import type { ActionResult, ParseReceiptResult, ScanEditInput, ScanItemInput } from "@/lib/types";
import { saveExpense } from "./actions";

const MAX_UPLOAD_BYTES = 3_500_000;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function revalidateScanPaths(groupId: string, scanId?: string) {
  revalidatePath(`/groups/${groupId}/scan`);
  if (scanId) revalidatePath(`/groups/${groupId}/scan/${scanId}`);
}

/** Upload + LLM parse. The client downscales to ~1600px JPEG before calling. */
export async function parseReceipt(groupId: string, formData: FormData): Promise<ParseReceiptResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const { group } = await requireRole(db, groupId, user.id, "member");

    const file = formData.get("image");
    if (!(file instanceof File)) return { ok: false, error: "No image received." };
    if (!ACCEPTED_TYPES.has(file.type)) {
      return { ok: false, error: "Only JPEG, PNG or WebP images are supported." };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return { ok: false, error: "The image is too large. Try a smaller photo." };
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const imageHash = createHash("sha256").update(bytes).digest("hex");

    // Same photo re-uploaded → jump to the existing scan, no LLM call.
    const existing = await db
      .select({ id: receiptScans.id })
      .from(receiptScans)
      .where(and(eq(receiptScans.groupId, groupId), eq(receiptScans.imageHash, imageHash)))
      .limit(1);
    if (existing[0]) return { ok: true, scanId: existing[0].id, duplicate: true };

    const outcome = await parseReceiptImage(bytes, file.type, group.currency);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    const { receipt } = outcome;

    const scanRows = await db
      .insert(receiptScans)
      .values({
        groupId,
        createdBy: user.id,
        merchant: receipt.merchant,
        date: receipt.date ?? todayString(),
        currency: receipt.currency,
        subtotalCents: receipt.subtotalCents,
        taxCents: receipt.taxCents,
        tipCents: receipt.tipCents,
        discountsCents: receipt.discountsCents,
        totalCents: receipt.totalCents,
        confidence: receipt.confidence,
        reconciles: outcome.reconciles,
        model: outcome.model,
        imageHash,
      })
      .returning({ id: receiptScans.id });
    const scanId = scanRows[0].id;

    // No transactions on the Neon HTTP driver — insert sequentially and clean
    // up the scan row (cascade) if a later step fails, so no orphan drafts.
    try {
      await db.insert(receiptScanImages).values({
        scanId,
        data: bytes,
        contentType: file.type,
        byteSize: bytes.byteLength,
      });
      await db.insert(receiptItems).values(
        receipt.items.map((item, position) => ({
          scanId,
          position,
          rawText: item.rawText,
          name: item.name,
          quantity: item.quantity,
          unitPriceCents: item.unitPriceCents,
          totalCents: item.totalCents,
          category: item.category,
        }))
      );
    } catch (error) {
      await db.delete(receiptScans).where(eq(receiptScans.id, scanId)).catch(() => {});
      throw error;
    }

    await logActivity(db, groupId, user, "receipt.scanned", {
      merchant: receipt.merchant,
      amountCents: receipt.totalCents,
      currency: receipt.currency,
      itemCount: receipt.items.length,
      reconciles: outcome.reconciles,
    });
    revalidateScanPaths(groupId);
    return { ok: true, scanId };
  } catch (e) {
    return fail(e);
  }
}

type ScanRow = typeof receiptScans.$inferSelect;

/** Validate + whole-document rewrite of a scan (delete + reinsert items, like saveExpense). */
async function persistScanEdits(
  db: Db,
  user: SessionUser,
  input: ScanEditInput
): Promise<
  | { ok: true; scan: ScanRow; items: ScanItemInput[]; aliasNames: Map<string, string> }
  | { ok: false; error: string }
> {
  const scanRows = await db.select().from(receiptScans).where(eq(receiptScans.id, input.scanId));
  const scan = scanRows[0];
  if (!scan) return { ok: false, error: "Scan not found." };
  await requireRole(db, scan.groupId, user.id, "member");

  if (!DATE_RE.test(input.date)) return { ok: false, error: "Invalid date." };
  if (!isSupportedCurrency(input.currency)) return { ok: false, error: "Unsupported currency." };
  for (const [label, value] of [
    ["tax", input.taxCents],
    ["tip", input.tipCents],
    ["discount", input.discountsCents],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      return { ok: false, error: `Invalid ${label} amount.` };
    }
  }
  if (!Number.isInteger(input.totalCents)) return { ok: false, error: "Invalid total." };
  if (input.items.length === 0) return { ok: false, error: "Keep at least one item." };
  if (input.items.length > MAX_RECEIPT_ITEMS) {
    return { ok: false, error: `At most ${MAX_RECEIPT_ITEMS} items are supported.` };
  }

  const groupAliases = await db.select().from(aliases).where(eq(aliases.groupId, scan.groupId));
  const aliasIds = new Set(groupAliases.map((a) => a.id));
  const aliasNames = new Map(groupAliases.map((a) => [a.id, a.name]));

  const items: ScanItemInput[] = [];
  for (const item of input.items) {
    const name = item.name.trim().slice(0, 200);
    if (!name) return { ok: false, error: "Every item needs a name." };
    if (typeof item.quantity !== "number" || !Number.isFinite(item.quantity) || item.quantity <= 0) {
      return { ok: false, error: `Invalid quantity for "${name}".` };
    }
    if (!Number.isInteger(item.totalCents)) return { ok: false, error: `Invalid price for "${name}".` };
    if (item.unitPriceCents !== null && !Number.isInteger(item.unitPriceCents)) {
      return { ok: false, error: `Invalid unit price for "${name}".` };
    }
    if (!ASSIGN_MODES.includes(item.assignMode)) {
      return { ok: false, error: `Invalid assignment for "${name}".` };
    }
    const shareIds = item.shares.map((s) => s.aliasId);
    if (shareIds.some((id) => !aliasIds.has(id)) || new Set(shareIds).size !== shareIds.length) {
      return { ok: false, error: `Invalid people assigned to "${name}".` };
    }
    if (item.assignMode === "unassigned" && item.shares.length > 0) {
      return { ok: false, error: `Invalid assignment for "${name}".` };
    }
    if (item.assignMode === "single" && item.shares.length !== 1) {
      return { ok: false, error: `Assign "${name}" to exactly one person.` };
    }
    if ((item.assignMode === "single" || item.assignMode === "equal") && item.shares.length >= 1) {
      if (item.shares.some((s) => s.exactCents !== null)) {
        return { ok: false, error: `Invalid assignment for "${name}".` };
      }
    }
    if (item.assignMode === "equal" && item.shares.length === 0) {
      return { ok: false, error: `Select who shares "${name}".` };
    }
    // Exact amounts must be integers, but summing to the line total is only
    // enforced at conversion (computePersonTotals) — a draft may temporarily
    // disagree after the user edits an already-split item's price.
    if (item.assignMode === "exact") {
      if (item.shares.length === 0) return { ok: false, error: `Select who shares "${name}".` };
      if (item.shares.some((s) => s.exactCents !== null && !Number.isInteger(s.exactCents))) {
        return { ok: false, error: `Invalid split amounts for "${name}".` };
      }
    }
    items.push({
      position: items.length,
      rawText: item.rawText?.slice(0, 300) ?? null,
      name,
      quantity: item.quantity,
      unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents,
      category: item.category?.slice(0, 40) ?? null,
      assignMode: item.assignMode,
      shares: item.shares,
    });
  }

  await db.delete(receiptItems).where(eq(receiptItems.scanId, scan.id));
  const inserted = await db
    .insert(receiptItems)
    .values(
      items.map((item) => ({
        scanId: scan.id,
        position: item.position,
        rawText: item.rawText,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        totalCents: item.totalCents,
        category: item.category,
        assignMode: item.assignMode,
      }))
    )
    .returning({ id: receiptItems.id });
  const shareValues = items.flatMap((item, i) =>
    item.shares.map((s) => ({ itemId: inserted[i].id, aliasId: s.aliasId, exactCents: s.exactCents }))
  );
  if (shareValues.length > 0) await db.insert(receiptItemShares).values(shareValues);

  const merchant = input.merchant?.trim().slice(0, 120) || null;
  await db
    .update(receiptScans)
    .set({
      merchant,
      date: input.date,
      currency: input.currency,
      taxCents: input.taxCents,
      tipCents: input.tipCents,
      discountsCents: input.discountsCents,
      totalCents: input.totalCents,
      reconciles: reconcile({ ...input, items }).ok,
      updatedAt: new Date(),
    })
    .where(eq(receiptScans.id, scan.id));

  revalidateScanPaths(scan.groupId, scan.id);
  return { ok: true, scan, items, aliasNames };
}

export async function saveScan(input: ScanEditInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const persisted = await persistScanEdits(db, user, input);
    if (!persisted.ok) return persisted;
    // Draft saves are not activity-logged — scan/convert/delete are the events.
    return { ok: true, id: persisted.scan.id };
  } catch (e) {
    return fail(e);
  }
}

/** Persist edits, then create (or update) the linked expense from the assignments. */
export async function convertScan(
  input: ScanEditInput & { payerAliasId: string }
): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const persisted = await persistScanEdits(db, user, input);
    if (!persisted.ok) return persisted;
    const { scan, items, aliasNames } = persisted;

    if (!aliasNames.has(input.payerAliasId)) return { ok: false, error: "Select who paid." };

    const convertItems: ConvertItem[] = items.map((item) => ({
      name: item.name,
      totalCents: item.totalCents,
      assignMode: item.assignMode,
      shares: item.shares,
    }));
    const totals = computePersonTotals(
      convertItems,
      { taxCents: input.taxCents, tipCents: input.tipCents, discountsCents: input.discountsCents },
      input.currency,
      aliasNames
    );
    if (!totals.ok) return totals;

    // Re-converting updates the linked expense — unless it was deleted (the FK
    // nulls the link) or vanished; then a fresh expense is created.
    let existingExpenseId: string | undefined;
    if (scan.expenseId) {
      const rows = await db
        .select({ id: expenses.id })
        .from(expenses)
        .where(and(eq(expenses.id, scan.expenseId), eq(expenses.groupId, scan.groupId)));
      existingExpenseId = rows[0]?.id;
    }

    const result = await saveExpense(
      buildExpenseInput({
        groupId: scan.groupId,
        existingExpenseId,
        merchant: input.merchant,
        date: input.date,
        currency: input.currency,
        payerAliasId: input.payerAliasId,
        persons: totals.persons,
        grandTotalCents: totals.grandTotalCents,
      })
    );
    if (!result.ok) return result;

    await db
      .update(receiptScans)
      .set({ expenseId: result.id, status: "converted", updatedAt: new Date() })
      .where(eq(receiptScans.id, scan.id));
    await logActivity(db, scan.groupId, user, "receipt.converted", {
      merchant: input.merchant,
      amountCents: totals.grandTotalCents,
      currency: input.currency,
      updated: !!existingExpenseId,
    });
    revalidateScanPaths(scan.groupId, scan.id);
    return { ok: true, id: result.id };
  } catch (e) {
    return fail(e);
  }
}

/** Removes the scan (image, items, shares cascade). A converted expense is kept. */
export async function deleteScan(scanId: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const db = await getDb();
    const rows = await db.select().from(receiptScans).where(eq(receiptScans.id, scanId));
    const scan = rows[0];
    if (!scan) return { ok: false, error: "Scan not found." };
    await requireRole(db, scan.groupId, user.id, "member");
    await db.delete(receiptScans).where(eq(receiptScans.id, scanId));
    await logActivity(db, scan.groupId, user, "receipt.deleted", {
      merchant: scan.merchant,
      amountCents: scan.totalCents,
      currency: scan.currency,
    });
    revalidateScanPaths(scan.groupId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

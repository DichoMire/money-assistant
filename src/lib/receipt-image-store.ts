import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { receiptScanImages } from "@/db/schema";

/**
 * Receipt-image bytes behind an interface (RFC 11 §f), so the storage vendor
 * is swappable without touching callers. Today: `ByteaStore` (Postgres bytea,
 * current behavior). When Neon storage pressure arrives (~1,700 scans on the
 * free 0.5 GB), add an S3-compatible `R2Store` (keys `receipts/<scanId>.jpg`)
 * plus the paged+verified migration script sketched in the RFC — the image
 * route keeps its membership check and streams or 302s to a presigned URL.
 *
 * Boundary notes:
 *  - RETENTION (delete-after-convert, 30-day drafts, account deletion) is
 *    RFC 04/08 policy; this store only moves bytes.
 *  - The set-based purges (cron sweep, account deletion) operate directly on
 *    receipt_scan_images by design under bytea; an external adapter must
 *    hook those two spots too — grep for "receipt_scan_images" when adding one.
 */
export interface ReceiptImageStore {
  put(db: Db, scanId: string, data: Uint8Array, contentType: string): Promise<void>;
  get(
    db: Db,
    scanId: string
  ): Promise<{ data: Uint8Array; contentType: string; byteSize: number } | null>;
  delete(db: Db, scanId: string): Promise<void>;
}

const byteaStore: ReceiptImageStore = {
  async put(db, scanId, data, contentType) {
    await db.insert(receiptScanImages).values({
      scanId,
      data,
      contentType,
      byteSize: data.byteLength,
    });
  },
  async get(db, scanId) {
    const rows = await db
      .select()
      .from(receiptScanImages)
      .where(eq(receiptScanImages.scanId, scanId));
    return rows[0] ?? null;
  },
  async delete(db, scanId) {
    await db.delete(receiptScanImages).where(eq(receiptScanImages.scanId, scanId));
  },
};

export function getReceiptImageStore(): ReceiptImageStore {
  // Env-selected once an alternative exists (e.g. RECEIPT_IMAGE_STORE=r2).
  return byteaStore;
}

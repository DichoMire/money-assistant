import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { users, scanUsage } from "@/db/schema";
import { entitlements, scanQuotaEnforced, type Plan } from "./entitlements";
import { todayString } from "./rates";

/**
 * Scan metering (RFC 04 §3.5 / RFC 09 §3.2). Semantics, decided:
 *  - the cap is checked BEFORE the LLM call; the counter increments only
 *    after a SUCCESSFUL parse (failures charge nothing — nothing was taken);
 *  - duplicate uploads (hash dedupe) never consume quota and never block;
 *  - the check-then-increment pair is not atomic: two concurrent scans at
 *    4/5 can land on 6. Bounded, favors the user, accepted;
 *  - a broken meter FAILS OPEN — it must never break the flagship feature.
 */

/** "YYYY-MM" on the Europe/Sofia day boundary, matching expense dates. */
export function currentScanPeriod(): string {
  return todayString().slice(0, 7);
}

export type ScanQuota = {
  used: number;
  limit: number;
  plan: Plan;
  /** False until billing exists — the counter renders, the cap never refuses. */
  enforced: boolean;
};

/** The user's quota state for the current Sofia month (fails open). */
export async function readScanQuota(db: Db, userId: string): Promise<ScanQuota | null> {
  try {
    const [userRows, usageRows] = await Promise.all([
      db
        .select({ plan: users.plan, planExpiresAt: users.planExpiresAt })
        .from(users)
        .where(eq(users.id, userId)),
      db
        .select({ count: scanUsage.count })
        .from(scanUsage)
        .where(and(eq(scanUsage.userId, userId), eq(scanUsage.period, currentScanPeriod()))),
    ]);
    if (!userRows[0]) return null;
    const ent = entitlements(userRows[0]);
    return {
      used: usageRows[0]?.count ?? 0,
      limit: ent.limits.scansPerMonth,
      plan: ent.plan,
      enforced: scanQuotaEnforced(),
    };
  } catch (error) {
    console.error("[scan-usage] quota read failed (failing open):", error);
    return null;
  }
}

/** Single atomic upsert — safe without a transaction. */
export async function incrementScanCount(db: Db, userId: string): Promise<void> {
  try {
    await db
      .insert(scanUsage)
      .values({ userId, period: currentScanPeriod(), count: 1 })
      .onConflictDoUpdate({
        target: [scanUsage.userId, scanUsage.period],
        set: { count: sql`${scanUsage.count} + 1` },
      });
  } catch (error) {
    // A few uncounted scans beat a broken scan flow.
    console.error("[scan-usage] increment failed:", error);
  }
}

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * In-Postgres sliding-window rate limiter (two-bucket weighting): counts the
 * current fixed window with one atomic upsert, then weighs in the previous
 * window's count by its remaining overlap. Zero external vendors, identical
 * behavior on PGlite in dev/CI, and Upstash-shaped so the backend could swap
 * in a one-file change if abuse volume ever outgrows the database.
 *
 * The upsert runs before the check, so rejected calls still cost one tiny
 * write — acceptable: every guarded resource (LLM call, third-party fetch,
 * long invocation) is far more expensive than the upsert, and every limited
 * action already sits behind auth.
 *
 * Fails OPEN: if the limiter itself errors, the action proceeds — a broken
 * meter must never break the product.
 */
export type RateLimitResult = { ok: true } | { ok: false; retryAfterSec: number };

export async function rateLimit(
  db: Db,
  key: string,
  opts: { max: number; windowSec: number }
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowMs = opts.windowSec * 1000;
  const curStartMs = Math.floor(now / windowMs) * windowMs;
  try {
    const rows = await db
      .insert(rateLimits)
      .values({ key, windowStart: new Date(curStartMs), count: 1 })
      .onConflictDoUpdate({
        target: [rateLimits.key, rateLimits.windowStart],
        set: { count: sql`${rateLimits.count} + 1` },
      })
      .returning({ count: rateLimits.count });
    const cur = rows[0]?.count ?? 1;
    const prevRows = await db
      .select({ count: rateLimits.count })
      .from(rateLimits)
      .where(and(eq(rateLimits.key, key), eq(rateLimits.windowStart, new Date(curStartMs - windowMs))));
    const prev = prevRows[0]?.count ?? 0;
    const elapsedFraction = (now - curStartMs) / windowMs;
    const weighted = prev * (1 - elapsedFraction) + cur;
    if (weighted > opts.max) {
      return {
        ok: false,
        retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - curStartMs)) / 1000)),
      };
    }
    return { ok: true };
  } catch (error) {
    console.error("[rate-limit] check failed (failing open):", error);
    return { ok: true };
  }
}

/** The applied limits, in one place. All keys are per-user unless noted. */
export const RATE_LIMITS = {
  /** parseReceipt — the LLM-spend guard. */
  scanPerMinute: { max: 5, windowSec: 60 },
  scanPerDay: { max: 30, windowSec: 86_400 },
  /** updateRatesNow — protects the Frankfurter API. Global across all users. */
  ratesGlobal: { max: 1, windowSec: 600 },
  ratesPerUser: { max: 3, windowSec: 3_600 },
  /** acceptInvite — token-guessing ceiling. */
  invitePerUser: { max: 10, windowSec: 3_600 },
  /** saveExpense/saveSettlement — fat-finger/abuse ceiling, invisible normally. */
  writePerUser: { max: 60, windowSec: 60 },
} as const;

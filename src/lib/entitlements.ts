/**
 * ============================================================================
 *  PUBLIC PROMISE — DO NOT VIOLATE
 *  „Неограничени разходи. Без реклами. Без дневни лимити."
 *  Unlimited expense entry, unlimited groups and members, balances, settle-up,
 *  debt simplification, and full visibility of your own history are FREE
 *  FOREVER. No ads, ever. This is the product's public anti-Splitwise stance
 *  and its entire marketing identity (docs/bg-market/10-growth-marketing).
 *  Splitwise's ~3-expenses/day cap is its #1 churn driver and the reason this
 *  app can exist. Never add an entitlement check to expense/group/settlement
 *  actions. Gate comfort, never core use.
 * ============================================================================
 *
 * The entire entitlement state is two columns on `users` (plan,
 * plan_expires_at) — processor-agnostic, so any future billing vendor swap
 * touches a webhook route and nothing here. Checks run in SERVER ACTIONS
 * only; page-level counters are UX, never authoritative.
 */

export type Plan = "free" | "plus";

export const PLAN_LIMITS = {
  //       scans/month · CSV/PDF export · spending charts (born gated — the
  //       features don't exist yet, but they arrive paid when they do)
  free: { scansPerMonth: 5, export: false, charts: false },
  plus: { scansPerMonth: 100, export: true, charts: true },
} as const;

/**
 * Hours a lapsed/stale plus plan keeps working. Webhooks always write expiry
 * as period-end PLUS this grace, so a webhook outage shorter than the window
 * has zero payer impact. Failure direction is asymmetric on purpose: stale
 * state degrades toward GRANTING, never toward locking a payer out mid-trip.
 */
export const PLAN_GRACE_HOURS = 72;

/**
 * Resolve effective entitlements from the two DB columns. Pure function of
 * (plan, planExpiresAt, now) so it is trivially unit-testable.
 */
export function entitlements(
  user: { plan: string; planExpiresAt: Date | null },
  now: Date = new Date()
): { plan: Plan; limits: (typeof PLAN_LIMITS)[Plan] } {
  const isPlus =
    user.plan === "plus" && (user.planExpiresAt === null || now < user.planExpiresAt);
  const plan: Plan = isPlus ? "plus" : "free";
  return { plan, limits: PLAN_LIMITS[plan] };
}

/**
 * The quota is enforced only when this flag is on (env SCAN_QUOTA_ENFORCED=1).
 * Until billing exists, metering records and the counter renders, but the cap
 * never refuses — gating before a checkout exists would strand users with no
 * way to pay.
 */
export function scanQuotaEnforced(): boolean {
  return process.env.SCAN_QUOTA_ENFORCED === "1";
}

import { and, eq, lt, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { groupInvites, notifications, rateLimits, verificationTokens } from "@/db/schema";
import { runDailyDigest } from "@/lib/email";
import { captureError } from "@/lib/monitoring";
import { refreshRates } from "@/lib/rates-fetch";

export const dynamic = "force-dynamic";

// Daily maintenance, hit by the Vercel cron configured in vercel.json:
//  1. fetch the day's ECB exchange rates (incl. gap repair for missed days)
//  2. deactivate invites older than their TTL
//  3. purge stale rate-limit windows
// Auth: in production CRON_SECRET is REQUIRED — a missing secret is a loud
// misconfiguration (500), not an open endpoint. Vercel sends it as a Bearer
// token. In development the endpoint stays open for convenience.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    console.error("[cron] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const rates = await refreshRates();
    const db = await getDb();
    const expired = await db
      .update(groupInvites)
      .set({ status: "expired" })
      .where(and(eq(groupInvites.status, "active"), lt(groupInvites.expiresAt, new Date())))
      .returning({ id: groupInvites.id });
    await db
      .delete(rateLimits)
      .where(lt(rateLimits.windowStart, sql`now() - interval '2 days'`));
    // Receipt-image retention (RFC 04/08): converted scans keep their photo
    // only when the user asked to; draft photos live at most 30 days. The
    // parsed items (the user's actual data) are never touched here.
    const purged = await db.execute(sql`
      DELETE FROM receipt_scan_images WHERE scan_id IN (
        SELECT id FROM receipt_scans
        WHERE (expense_id IS NOT NULL AND keep_image = false)
           OR (expense_id IS NULL AND updated_at < now() - interval '30 days')
      )
    `);
    // Notification housekeeping: the bell is a recency surface (90-day
    // retention; activity_log remains the archive) + expired magic-link
    // tokens die here too.
    await db
      .delete(notifications)
      .where(lt(notifications.createdAt, sql`now() - interval '90 days'`));
    await db.delete(verificationTokens).where(lt(verificationTokens.expires, new Date()));
    // The email digest (no-op until RESEND_API_KEY/EMAIL_FROM exist).
    const digest = await runDailyDigest(db);
    const result = {
      ok: true,
      ...rates,
      expiredInvites: expired.length,
      purgedImages: (purged as unknown as { rowCount?: number }).rowCount ?? 0,
      digest,
    };
    // Dead-man's switch: ping an external monitor on SUCCESS only, so silence
    // (a failing or never-running cron) raises an alert there. Optional.
    if (process.env.CRON_PING_URL) {
      await fetch(process.env.CRON_PING_URL).catch(() => {});
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[cron] daily run failed:", error);
    captureError(error, { source: "cron-daily" });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Maintenance run failed" },
      { status: 500 }
    );
  }
}

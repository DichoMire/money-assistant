import { and, eq, lt } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { groupInvites } from "@/db/schema";
import { refreshRates } from "@/lib/rates-fetch";

export const dynamic = "force-dynamic";

// Daily maintenance, hit by the Vercel cron configured in vercel.json:
//  1. fetch the day's ECB exchange rates
//  2. deactivate invites older than 7 days
// When a CRON_SECRET env var is set, Vercel sends it as a Bearer token and we
// require it; without one the endpoint stays open (both tasks are idempotent).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
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
    return NextResponse.json({ ok: true, ...rates, expiredInvites: expired.length });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Maintenance run failed" },
      { status: 500 }
    );
  }
}

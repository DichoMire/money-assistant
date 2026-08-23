import { NextResponse } from "next/server";
import { refreshRates } from "@/lib/rates-fetch";

export const dynamic = "force-dynamic";

// Hit daily by the Vercel cron job configured in vercel.json. When a
// CRON_SECRET env var is set, Vercel sends it as a Bearer token and we require
// it; without one the endpoint stays open (it only refreshes public FX rates).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await refreshRates();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Rate refresh failed" },
      { status: 500 }
    );
  }
}

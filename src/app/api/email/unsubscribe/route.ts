import { eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import type { NotifyPrefs } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * No-login unsubscribe (RFC 07 §3.5): the per-user token IS the auth.
 * Supports both the visible footer link (GET) and RFC 8058 one-click (POST,
 * Gmail/Yahoo requirement — the List-Unsubscribe-Post header points here).
 * Idempotent. cat: digest | reminders | addedToGroup | all.
 */
async function unsubscribe(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const cat = url.searchParams.get("cat") ?? "all";
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.unsubscribeToken, token));
  const user = rows[0];
  if (!user) return NextResponse.json({ error: "Unknown token" }, { status: 404 });

  const prefs: NotifyPrefs = { ...(user.notifyPrefs ?? {}) };
  if (cat === "digest") prefs.digest = "off";
  else if (cat === "reminders") prefs.emailReminders = false;
  else if (cat === "addedToGroup") prefs.emailAddedToGroup = false;
  await db
    .update(users)
    .set(cat === "all" ? { unsubscribedAt: sql`now()` } : { notifyPrefs: prefs })
    .where(eq(users.id, user.id));

  const bg = user.locale === "bg";
  const heading = bg ? "Отписахте се." : "You're unsubscribed.";
  const detail =
    cat === "all"
      ? bg
        ? "Няма да получавате повече имейли от Money Assistant."
        : "You won't receive any more email from Money Assistant."
      : bg
        ? "Няма да получавате повече имейли от този вид."
        : "You won't receive this kind of email any more.";
  const back = bg ? "Настройки на известията" : "Notification settings";
  return new Response(
    `<!doctype html><html lang="${bg ? "bg" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Money Assistant</title></head>
<body style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;background:#f4f6f8;color:#1f2937">
<div style="background:#fff;border-radius:16px;padding:32px;max-width:380px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.08)">
<div style="display:inline-block;background:#1cc29f;color:#fff;border-radius:10px;padding:4px 12px;font-weight:700;font-size:20px">€</div>
<h1 style="font-size:18px;margin:16px 0 8px">${heading}</h1>
<p style="font-size:14px;color:#6b7280;margin:0 0 20px">${detail}</p>
<a href="/settings" style="color:#0f766e;font-weight:600;font-size:14px">${back}</a>
</div></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

export async function GET(request: Request) {
  return unsubscribe(request);
}

export async function POST(request: Request) {
  return unsubscribe(request);
}

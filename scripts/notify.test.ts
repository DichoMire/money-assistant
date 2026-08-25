/* Notification/email layer tests (RFC 07) against in-memory PGlite with a
   mocked Resend API: recipient computation, guard rails, digest idempotency,
   unsubscribe semantics. Run: npm run test:notify */
import { strict as assert } from "node:assert";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
// Enable the (mocked) email layer.
process.env.RESEND_API_KEY = "test-key";
process.env.EMAIL_FROM = "Money Assistant <notify@test.local>";

import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../src/db";
import { aliases, groupMembers, groups, notifications, users } from "../src/db/schema";
import { notifyUsers } from "../src/lib/action-helpers";
import { runDailyDigest, sendNotificationEmail } from "../src/lib/email";

type SentMail = { to: string; subject: string; headers?: Record<string, string>; text: string };
const sentMails: SentMail[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
  if (String(url).includes("api.resend.com")) {
    sentMails.push(JSON.parse(String(init?.body)) as SentMail & { to: string[] });
    return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
  }
  return realFetch(url, init);
}) as typeof fetch;

async function main() {
  const db = await getDb();
  const [ana] = await db
    .insert(users)
    .values({ email: "ana@test.local", name: "Ana", locale: "bg" })
    .returning();
  const [ben] = await db.insert(users).values({ email: "ben@test.local", name: "Ben" }).returning();
  const [out] = await db.insert(users).values({ email: "out@test.local", name: "Out" }).returning();
  const [group] = await db
    .insert(groups)
    .values({ userId: ana.id, name: "Морето", currency: "EUR" })
    .returning();
  await db.insert(aliases).values({ groupId: group.id, name: "Ana", userId: ana.id });
  await db.insert(groupMembers).values({ groupId: group.id, userId: ben.id });

  const actor = { id: ben.id, email: ben.email, name: "Ben" };

  // ---- notifyUsers: actor excluded, nulls dropped, dedup ----
  await notifyUsers(db, [ana.id, ana.id, ben.id, null, undefined], {
    groupId: group.id,
    groupName: group.name,
    type: "expense.involves_you",
    actor,
    details: { description: "Вечеря", amountCents: 3000, currency: "EUR" },
  });
  const rows = await db.select().from(notifications);
  assert.equal(rows.length, 1, "one row: actor excluded, duplicate id deduped");
  assert.equal(rows[0].userId, ana.id);
  assert.equal(rows[0].groupName, "Морето");
  console.log("notifyUsers recipient computation ok");

  // ---- immediate email guard rails ----
  // A member in good standing gets the mail (recipient-locale subject) and
  // the row is stamped emailed.
  await sendNotificationEmail(db, rows[0].id, ana.id, group.id, "settle.reminder", "Ben", group.name, {
    amountCents: 1500,
    currency: "EUR",
  });
  assert.equal(sentMails.length, 1);
  assert.ok(sentMails[0].subject.includes("напомня"), "subject in the RECIPIENT's locale (bg)");
  assert.ok(sentMails[0].headers?.["List-Unsubscribe"]?.includes("token="));
  assert.equal(sentMails[0].headers?.["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const stamped = await db.select().from(notifications).where(eq(notifications.id, rows[0].id));
  assert.ok(stamped[0].emailedAt !== null);

  // A non-member is never emailed (G7).
  const [row2] = await db
    .insert(notifications)
    .values({
      userId: out.id,
      groupId: group.id,
      groupName: group.name,
      type: "settle.reminder",
      actorName: "Ben",
      details: {},
    })
    .returning();
  await sendNotificationEmail(db, row2.id, out.id, group.id, "settle.reminder", "Ben", group.name, {});
  assert.equal(sentMails.length, 1, "non-member must not be emailed");

  // A muted category is skipped silently.
  await db.update(users).set({ notifyPrefs: { emailReminders: false } }).where(eq(users.id, ana.id));
  const [row3] = await db
    .insert(notifications)
    .values({
      userId: ana.id,
      groupId: group.id,
      groupName: group.name,
      type: "settle.reminder",
      actorName: "Ben",
      details: {},
    })
    .returning();
  await sendNotificationEmail(db, row3.id, ana.id, group.id, "settle.reminder", "Ben", group.name, {});
  assert.equal(sentMails.length, 1, "muted category must not send");
  await db.update(users).set({ notifyPrefs: {} }).where(eq(users.id, ana.id));
  console.log("immediate email guard rails ok");

  // ---- digest idempotency ----
  // row3 is still un-emailed → the digest picks it up; the second run is a
  // no-op; unsubscribed users get nothing.
  const first = await runDailyDigest(db);
  assert.equal(first.sent, 1);
  assert.ok(sentMails[1].subject.length > 0);
  const second = await runDailyDigest(db);
  assert.equal(second.sent, 0, "second run must send nothing (emailedAt idempotency)");

  await db
    .insert(notifications)
    .values({
      userId: ana.id,
      groupId: group.id,
      groupName: group.name,
      type: "expense.updated",
      actorName: "Ben",
      details: { description: "Такси" },
    });
  await db.update(users).set({ unsubscribedAt: new Date() }).where(eq(users.id, ana.id));
  const third = await runDailyDigest(db);
  assert.equal(third.sent, 0, "globally unsubscribed user gets no digest");
  const unmailed = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, ana.id), isNull(notifications.emailedAt)));
  assert.equal(unmailed.length, 1, "the row stays pending, not silently stamped");
  console.log("digest idempotency + unsubscribe ok");

  console.log("All notification tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

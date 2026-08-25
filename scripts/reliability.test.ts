/* Reliability-layer tests: withTransaction rollback, the in-Postgres rate
   limiter, FX gap repair (mocked fetch), and the approx-rate flag.
   Runs against an IN-MEMORY PGlite via PGLITE_DIR=memory://.
   Run: npm run test:reliability */
import { strict as assert } from "node:assert";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

import { eq } from "drizzle-orm";
import { getDb, withTransaction } from "../src/db";
import { fxRates, groups, rateLimits, users } from "../src/db/schema";
import { rateLimit } from "../src/lib/rate-limit";
import { findRateRowWithFlag } from "../src/lib/rates";
import { hasMissingWeekdayBetween, refreshRates } from "../src/lib/rates-fetch";

async function testTransactionRollback() {
  const db = await getDb();
  const [user] = await db.insert(users).values({ email: "tx@test.local" }).returning();
  await assert.rejects(
    withTransaction(async (tx) => {
      await tx.insert(groups).values({ userId: user.id, name: "Doomed", currency: "EUR" });
      throw new Error("boom");
    }),
    /boom/
  );
  const rows = await db.select().from(groups).where(eq(groups.userId, user.id));
  assert.equal(rows.length, 0, "rolled-back insert must not persist");

  // And a successful transaction commits.
  await withTransaction(async (tx) => {
    await tx.insert(groups).values({ userId: user.id, name: "Kept", currency: "EUR" });
  });
  const kept = await db.select().from(groups).where(eq(groups.userId, user.id));
  assert.equal(kept.length, 1);
  console.log("withTransaction rollback/commit ok");
}

async function testRateLimit() {
  const db = await getDb();
  // Pin "now" to a window start so the previous-window weight is exactly 1.
  const realNow = Date.now;
  const windowSec = 3600;
  const windowMs = windowSec * 1000;
  const base = Math.floor(realNow() / windowMs) * windowMs;
  Date.now = () => base;
  try {
    for (let i = 0; i < 3; i += 1) {
      const r = await rateLimit(db, "test:a", { max: 3, windowSec });
      assert.equal(r.ok, true, `call ${i + 1} within the limit must pass`);
    }
    const rejected = await rateLimit(db, "test:a", { max: 3, windowSec });
    assert.equal(rejected.ok, false, "4th call must be rejected");
    if (!rejected.ok) assert.ok(rejected.retryAfterSec >= 1);

    // Independent keys don't interfere.
    assert.equal((await rateLimit(db, "test:b", { max: 3, windowSec })).ok, true);

    // Sliding window: a full previous window still weighs in mid-window.
    await db.insert(rateLimits).values({
      key: "test:c",
      windowStart: new Date(base - windowMs),
      count: 10,
    });
    Date.now = () => base + windowMs / 2; // half the previous window still counts
    const weighted = await rateLimit(db, "test:c", { max: 5, windowSec });
    assert.equal(weighted.ok, false, "10*0.5 + 1 = 6 > 5 must reject");

    // After the previous window ages out entirely, requests pass again.
    Date.now = () => base + 2 * windowMs;
    assert.equal((await rateLimit(db, "test:c", { max: 5, windowSec })).ok, true);
  } finally {
    Date.now = realNow;
  }
  console.log("rate limiter ok");
}

async function testGapRepair() {
  const db = await getDb();
  await db.delete(fxRates);
  // Seed one stored row: Tue 2026-08-18. The mocked /latest returns Tue
  // 2026-08-25 -> weekdays are missing in between -> a range fetch repairs.
  await db.insert(fxRates).values({ date: "2026-08-18", base: "EUR", rates: { USD: 1.1 } });

  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.endsWith("/latest")) {
      return new Response(
        JSON.stringify({ base: "EUR", date: "2026-08-25", rates: { USD: 1.2 } })
      );
    }
    // Range: business days of the gap (ECB skips weekends).
    return new Response(
      JSON.stringify({
        base: "EUR",
        rates: {
          "2026-08-19": { USD: 1.11 },
          "2026-08-20": { USD: 1.12 },
          "2026-08-21": { USD: 1.13 },
          "2026-08-24": { USD: 1.14 },
          "2026-08-25": { USD: 1.2 },
        },
      })
    );
  }) as typeof fetch;
  try {
    const result = await refreshRates();
    assert.equal(result.latestDate, "2026-08-25");
    assert.equal(calls.length, 2, "latest + one range repair fetch");
    assert.ok(calls[1].includes("2026-08-18..2026-08-25"));
    const stored = await db.select().from(fxRates);
    assert.equal(stored.length, 6); // seed + 5 repaired/new days
    assert.equal(stored.find((r) => r.date === "2026-08-24")?.rates.USD, 1.14);

    // Friday -> Monday: only the weekend is "missing" -> no range fetch.
    await db.delete(fxRates);
    await db.insert(fxRates).values({ date: "2026-08-21", base: "EUR", rates: { USD: 1.1 } });
    calls.length = 0;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ base: "EUR", date: "2026-08-24", rates: { USD: 1.15 } })
      )) as typeof fetch;
    await refreshRates();
    const stored2 = await db.select().from(fxRates);
    assert.equal(stored2.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.equal(hasMissingWeekdayBetween("2026-08-21", "2026-08-24"), false); // Fri -> Mon
  assert.equal(hasMissingWeekdayBetween("2026-08-21", "2026-08-25"), true); // Mon missing
  assert.equal(hasMissingWeekdayBetween("2026-08-24", "2026-08-25"), false); // consecutive
  console.log("fx gap repair ok");
}

function testApproxFlag() {
  const rows = [
    { date: "2026-08-20", rates: { USD: 1.1 } },
    { date: "2026-08-22", rates: { USD: 1.2 } },
  ];
  assert.deepEqual(findRateRowWithFlag(rows, "2026-08-23"), { row: rows[1], approx: false });
  assert.deepEqual(findRateRowWithFlag(rows, "2026-08-21"), { row: rows[0], approx: false });
  // Predates every stored row -> earliest row, flagged approximate.
  assert.deepEqual(findRateRowWithFlag(rows, "2026-08-01"), { row: rows[0], approx: true });
  assert.deepEqual(findRateRowWithFlag([], "2026-08-01"), { row: null, approx: false });
  console.log("approx-rate flag ok");
}

async function main() {
  await testTransactionRollback();
  await testRateLimit();
  await testGapRepair();
  testApproxFlag();
  console.log("All reliability tests passed.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

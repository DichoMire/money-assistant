/* Seed demo data into the local dev database for a given account.
   Run while the dev server is STOPPED (PGlite is single-process):
     npx tsx scripts/seed-dev.ts you@example.com
   Then start `npm run dev` and log in with that email via the dev login. */
import { eq } from "drizzle-orm";
import { getDb } from "../src/db";
import { aliases, expensePayers, expenseShares, expenses, fxRates, groups, users } from "../src/db/schema";

const email = process.argv[2] ?? "dev@example.com";

async function main() {
  const db = await getDb();
  const [user] = await db
    .insert(users)
    .values({ email, name: email.split("@")[0] })
    .onConflictDoUpdate({ target: users.email, set: { email } })
    .returning();

  const [group] = await db
    .insert(groups)
    .values({ userId: user.id, name: "Demo trip", currency: "USD" })
    .returning();
  const [anna] = await db.insert(aliases).values({ groupId: group.id, name: "Anna" }).returning();
  const [ben] = await db.insert(aliases).values({ groupId: group.id, name: "Ben" }).returning();
  const [cara] = await db.insert(aliases).values({ groupId: group.id, name: "Cara" }).returning();

  const today = new Date().toISOString().slice(0, 10);
  await db
    .insert(fxRates)
    .values({ date: today, base: "EUR", rates: { USD: 1.1, GBP: 0.85 } })
    .onConflictDoNothing();

  // Multi-payer dinner: Anna 40 + Ben 20, split equally three ways.
  const [dinner] = await db
    .insert(expenses)
    .values({ groupId: group.id, description: "Dinner", amountCents: 6000, currency: "USD", date: today, splitMethod: "equal" })
    .returning();
  await db.insert(expensePayers).values([
    { expenseId: dinner.id, aliasId: anna.id, paidCents: 4000 },
    { expenseId: dinner.id, aliasId: ben.id, paidCents: 2000 },
  ]);
  await db.insert(expenseShares).values([
    { expenseId: dinner.id, aliasId: anna.id, owedCents: 2000, splitValue: null },
    { expenseId: dinner.id, aliasId: ben.id, owedCents: 2000, splitValue: null },
    { expenseId: dinner.id, aliasId: cara.id, owedCents: 2000, splitValue: null },
  ]);

  // Foreign-currency coffee: Ben paid £11.00, all owed by Cara.
  const [coffee] = await db
    .insert(expenses)
    .values({ groupId: group.id, description: "Coffee", amountCents: 1100, currency: "GBP", date: today, splitMethod: "exact" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: coffee.id, aliasId: ben.id, paidCents: 1100 });
  await db.insert(expenseShares).values({ expenseId: coffee.id, aliasId: cara.id, owedCents: 1100, splitValue: 1100 });

  // Settlement: Cara paid Anna $5.
  const [pay] = await db
    .insert(expenses)
    .values({ groupId: group.id, kind: "settlement", description: "Payment", amountCents: 500, currency: "USD", date: today, splitMethod: "exact" })
    .returning();
  await db.insert(expensePayers).values({ expenseId: pay.id, aliasId: cara.id, paidCents: 500 });
  await db.insert(expenseShares).values({ expenseId: pay.id, aliasId: anna.id, owedCents: 500, splitValue: 500 });

  const groupCount = await db.select().from(groups).where(eq(groups.userId, user.id));
  console.log(`Seeded "${group.name}" (${group.id}) for ${email}. Groups for this user: ${groupCount.length}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});

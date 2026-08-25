/* Golden-set eval harness for the receipt pipeline (RFC 04 §3.3). Reports,
   never asserts — a model swap becomes a measured half-day instead of a leap
   of faith.

   Fixtures live in RECEIPT_FIXTURES_DIR (default scripts/receipt-fixtures/),
   one folder per case: NNN-slug/image.jpg + truth.json (a ParsedReceipt-like
   truth plus optional {era, chain, quality} tags). REAL RECEIPTS ARE PERSONAL
   DATA — the folder is gitignored; only manifest.json (id, chain, era,
   sha256) is committed so runs are comparable across machines.

   Usage:
     OPENROUTER_API_KEY=... npx tsx scripts/receipt-eval.ts
       [--model X]                  override the env model
       [--baseline eval-report.json] print deltas vs a previous run
       [--only chain=billa]         filter fixtures by a truth.json tag
   Writes eval-report.json next to the fixtures dir. Costs money on paid
   models — run deliberately, not in CI-on-push (the CI job is manual).

   Initial thresholds (revise with the first real baseline, never below it):
   item recall >= 0.90 · reconcile rate >= 0.80 · total accuracy >= 0.90. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseReceiptImage } from "../src/lib/receipt-parse";
import type { ParsedReceipt } from "../src/lib/receipt-schema";

const FIXTURES_DIR = process.env.RECEIPT_FIXTURES_DIR ?? "scripts/receipt-fixtures";
const REPORT_FILE = "eval-report.json";

type Truth = Partial<ParsedReceipt> & {
  items: { name: string; totalCents: number }[];
  era?: string;
  chain?: string;
  quality?: string;
};

type CaseResult = {
  id: string;
  ok: boolean;
  model?: string;
  itemRecall?: number;
  itemPrecision?: number;
  reconciles?: boolean;
  totalExact?: boolean;
  dateExact?: boolean;
  merchantExact?: boolean;
  currencyExact?: boolean;
  dualCaptured?: boolean | null;
  costMicroUsd?: number | null;
  latencyMs?: number;
  error?: string;
};

const normName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-zа-я0-9]+/gi, " ")
    .trim();

function similarity(a: string, b: string): number {
  const wa = new Set(normName(a).split(" "));
  const wb = new Set(normName(b).split(" "));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common += 1;
  return common / Math.max(wa.size, wb.size);
}

/** Greedy one-to-one matching: exact totalCents first, then name sim >= 0.5. */
function matchItems(
  predicted: { name: string; totalCents: number }[],
  truth: { name: string; totalCents: number }[]
): number {
  const usedPred = new Set<number>();
  let matched = 0;
  for (const t of truth) {
    let best = -1;
    let bestScore = 0;
    predicted.forEach((p, i) => {
      if (usedPred.has(i)) return;
      const score =
        p.totalCents === t.totalCents
          ? 1 + similarity(p.name, t.name)
          : similarity(p.name, t.name) >= 0.5
            ? similarity(p.name, t.name)
            : 0;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    if (best !== -1 && bestScore > 0) {
      usedPred.add(best);
      matched += 1;
    }
  }
  return matched;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (xs: boolean[]) => (xs.length ? xs.filter(Boolean).length / xs.length : 0);

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 ? args[i + 1] : undefined;
  };
  if (flag("model")) process.env.OPENROUTER_MODEL = flag("model");
  const only = flag("only"); // e.g. "chain=billa"

  if (!existsSync(FIXTURES_DIR)) {
    console.error(
      `No fixtures at ${FIXTURES_DIR}. Add NNN-slug/image.jpg + truth.json cases ` +
        `(target: 30+ across Billa/Kaufland/Lidl/Fantastico/restaurant × eras × photo quality).`
    );
    process.exit(1);
  }
  const caseDirs = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if (caseDirs.length === 0) {
    console.error(`Fixtures dir ${FIXTURES_DIR} is empty.`);
    process.exit(1);
  }

  const manifest: { id: string; chain?: string; era?: string; sha256: string }[] = [];
  const results: CaseResult[] = [];

  for (const id of caseDirs) {
    const dir = path.join(FIXTURES_DIR, id);
    const imagePath = ["image.jpg", "image.jpeg", "image.png", "image.webp"]
      .map((f) => path.join(dir, f))
      .find(existsSync);
    const truthPath = path.join(dir, "truth.json");
    if (!imagePath || !existsSync(truthPath)) {
      console.warn(`skip ${id}: needs image.* and truth.json`);
      continue;
    }
    const truth = JSON.parse(readFileSync(truthPath, "utf8")) as Truth;
    if (only) {
      const [k, v] = only.split("=");
      if (String((truth as Record<string, unknown>)[k]) !== v) continue;
    }
    const bytes = new Uint8Array(readFileSync(imagePath));
    manifest.push({
      id,
      chain: truth.chain,
      era: truth.era,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    const contentType = imagePath.endsWith(".png")
      ? "image/png"
      : imagePath.endsWith(".webp")
        ? "image/webp"
        : "image/jpeg";
    process.stdout.write(`${id} … `);
    const outcome = await parseReceiptImage(bytes, contentType, truth.currency ?? "EUR");
    if (!outcome.ok) {
      console.log(`FAILED (${outcome.code})`);
      results.push({ id, ok: false, error: outcome.code });
      continue;
    }
    const r = outcome.receipt;
    const matched = matchItems(r.items, truth.items);
    const result: CaseResult = {
      id,
      ok: true,
      model: outcome.model,
      itemRecall: truth.items.length ? matched / truth.items.length : 1,
      itemPrecision: r.items.length ? matched / r.items.length : 0,
      reconciles: outcome.reconciles,
      totalExact: truth.totalCents === undefined ? undefined : r.totalCents === truth.totalCents,
      dateExact: truth.date === undefined ? undefined : r.date === truth.date,
      merchantExact:
        truth.merchant === undefined || truth.merchant === null
          ? undefined
          : similarity(r.merchant ?? "", truth.merchant) >= 0.5,
      currencyExact: truth.currency === undefined ? undefined : r.currency === truth.currency,
      dualCaptured:
        truth.secondTotalCents === undefined || truth.secondTotalCents === null
          ? null
          : r.secondTotalCents === truth.secondTotalCents,
      costMicroUsd: outcome.costMicroUsd,
      latencyMs: outcome.latencyMs,
    };
    results.push(result);
    console.log(
      `recall ${(result.itemRecall! * 100).toFixed(0)}% · reconcile ${result.reconciles ? "✓" : "✗"} · ${outcome.latencyMs}ms`
    );
  }

  const okResults = results.filter((r) => r.ok);
  const summary = {
    model: process.env.OPENROUTER_MODEL ?? "(default ladder)",
    cases: results.length,
    parsed: okResults.length,
    itemRecall: avg(okResults.map((r) => r.itemRecall!)),
    itemPrecision: avg(okResults.map((r) => r.itemPrecision!)),
    reconcileRate: rate(okResults.map((r) => r.reconciles!)),
    totalAccuracy: rate(okResults.filter((r) => r.totalExact !== undefined).map((r) => r.totalExact!)),
    dateAccuracy: rate(okResults.filter((r) => r.dateExact !== undefined).map((r) => r.dateExact!)),
    currencyAccuracy: rate(
      okResults.filter((r) => r.currencyExact !== undefined).map((r) => r.currencyExact!)
    ),
    dualCaptureRate: rate(
      okResults.filter((r) => r.dualCaptured !== null).map((r) => r.dualCaptured!)
    ),
    avgLatencyMs: Math.round(avg(okResults.map((r) => r.latencyMs!))),
    totalCostMicroUsd: okResults.reduce((s, r) => s + (r.costMicroUsd ?? 0), 0),
    generatedAt: new Date().toISOString(),
  };

  console.log("\n=== summary ===");
  for (const [k, v] of Object.entries(summary)) {
    console.log(`${k.padEnd(20)} ${typeof v === "number" ? v.toFixed(3) : v}`);
  }

  const baselinePath = flag("baseline");
  if (baselinePath && existsSync(baselinePath)) {
    const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as {
      summary?: Record<string, unknown>;
    };
    console.log("\n=== deltas vs baseline ===");
    for (const key of ["itemRecall", "itemPrecision", "reconcileRate", "totalAccuracy"]) {
      const now = summary[key as keyof typeof summary] as number;
      const then = Number(baseline.summary?.[key] ?? NaN);
      if (Number.isFinite(then)) {
        const d = now - then;
        console.log(`${key.padEnd(20)} ${d >= 0 ? "+" : ""}${d.toFixed(3)}`);
      }
    }
  }

  writeFileSync(REPORT_FILE, JSON.stringify({ summary, results }, null, 2));
  writeFileSync(path.join(FIXTURES_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nwrote ${REPORT_FILE} and ${FIXTURES_DIR}/manifest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import {
  buildReceiptPrompt,
  extractJson,
  reconcile,
  validateParsedReceipt,
  type ParsedReceipt,
} from "./receipt-schema";

/**
 * Server-side receipt extraction through OpenRouter's OpenAI-compatible chat
 * endpoint (plain fetch, mirroring rates-fetch.ts — no SDK). The models are
 * env vars so upgrading from free models to a paid one is config-only.
 *
 * Free vision endpoints are unreliable in ways paid ones aren't — shared
 * upstream rate-limit pools (both Gemma variants 429 together), responses
 * that hang after headers, and reasoning modes that burn the whole token
 * budget and return empty content. Hence: a ladder of models walked with a
 * per-attempt timeout, reasoning explicitly disabled, and a salvage path
 * that pulls JSON out of the reasoning field when content comes back empty.
 */

/*
 * Queue-trigger checklist (RFC 04 §3.7 — parsing stays SYNCHRONOUS until one
 * of these is true; re-evaluate then, not before):
 *  1. sustained p95 parse latency > ~30s (receipt_scans.latency_ms has the data);
 *  2. a batch/multi-receipt upload feature;
 *  3. server-side automatic retries (incl. retry-at-higher-res) instead of
 *     user-driven ones;
 *  4. function-duration or concurrency pressure on the Vercel plan.
 */

/** OpenAI-compatible chat-completions endpoint. Pointing this at
 *  https://eu.api.openai.com/v1/chat/completions (with RECEIPT_API_KEY
 *  holding an OpenAI key and OPENROUTER_MODEL=gpt-5-mini) is the
 *  EU-residency option with zero further code. */
const apiUrl = () =>
  process.env.RECEIPT_API_URL || "https://openrouter.ai/api/v1/chat/completions";
/* Free vision endpoints also disappear without notice (nemotron-nano-12b-v2-vl
   started 404ing), so this ladder needs the occasional availability re-check
   against https://openrouter.ai/api/v1/models. Only one Gemma variant is
   listed: both share one upstream rate-limit pool, so the second adds timeout
   risk without independence. */
const DEFAULT_MODEL = "minimax/minimax-m3:free";
const DEFAULT_FALLBACK_MODELS = [
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "dots-studio/dots-3-note-preview:free",
  "google/gemma-4-26b-a4b-it:free",
];
const ATTEMPT_TIMEOUT_MS = 35_000;
// Stop walking the ladder past this point so the worst case (every model
// hanging out its full timeout) still fits the scan page's maxDuration = 120.
const TOTAL_BUDGET_MS = 80_000;

export type ParseFailureCode =
  | "no_api_key"
  | "rate_limited"
  | "provider_error"
  | "invalid_response"
  | "not_a_receipt";

export type ParseOutcome =
  | {
      ok: true;
      receipt: ParsedReceipt;
      reconciles: boolean;
      diffCents: number;
      model: string;
      /** Provider-reported cost in µUSD (OpenRouter usage.cost); null when
       *  the endpoint reports none. */
      costMicroUsd: number | null;
      /** End-to-end parse latency incl. ladder walking. */
      latencyMs: number;
    }
  | { ok: false; code: ParseFailureCode; error: string; busyHint?: boolean };

export const PARSE_ERROR_MESSAGES: Record<ParseFailureCode, string> = {
  no_api_key: "Receipt scanning is not configured (missing OPENROUTER_API_KEY).",
  rate_limited: "The receipt service is rate-limited right now — try again in a minute.",
  provider_error: "The receipt service is unavailable right now — try again shortly.",
  invalid_response: "The receipt couldn't be read automatically. Try again, or use a sharper, tighter photo of just the receipt.",
  not_a_receipt: "This image doesn't look like a purchase receipt.",
};

type AttemptResult =
  | { kind: "ok"; receipt: ParsedReceipt; costMicroUsd: number | null }
  | { kind: "rate_limited" }
  | { kind: "not_a_receipt" }
  | { kind: "failed"; failClass: "http" | "network" | "content"; detail: string };

async function attempt(
  model: string,
  apiKey: string,
  imageDataUrl: string,
  groupCurrency: string
): Promise<AttemptResult> {
  const url = apiUrl();
  const onOpenRouter = url.includes("openrouter.ai");
  // Free endpoints reject/ignore strict schemas unpredictably; paid models
  // honor them and produce cleaner JSON. The salvage path below stays as
  // belt-and-braces either way.
  const structured = !model.endsWith(":free");
  const provider: Record<string, unknown> = {};
  // OPENROUTER_ZDR=true restricts routing to zero-data-retention endpoints.
  if (onOpenRouter && process.env.OPENROUTER_ZDR === "true") provider.zdr = true;
  if (onOpenRouter && structured) provider.require_parameters = true;

  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter attribution niceties (optional).
        "HTTP-Referer": process.env.APP_URL ?? "http://localhost:3000",
        "X-Title": "Money Assistant",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8000,
        // Free reasoning-mode models can spend the entire budget "thinking"
        // and return empty content; models without a toggle ignore this.
        reasoning: { enabled: false },
        ...(structured
          ? {
              response_format: {
                type: "json_schema",
                json_schema: { name: "receipt", strict: false, schema: RECEIPT_JSON_SCHEMA },
              },
            }
          : {}),
        ...(Object.keys(provider).length > 0 ? { provider } : {}),
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: imageDataUrl } },
              { type: "text", text: buildReceiptPrompt(groupCurrency) },
            ],
          },
        ],
      }),
    });
    if (response.status === 429) return { kind: "rate_limited" };
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { kind: "failed", failClass: "http", detail: `HTTP ${response.status} ${body.slice(0, 300)}` };
    }
    payload = await response.json();
  } catch (error) {
    return {
      kind: "failed",
      failClass: "network",
      detail: error instanceof Error ? error.message : "network error",
    };
  }

  const message = (payload as { choices?: { message?: { content?: unknown; reasoning?: unknown } }[] })
    ?.choices?.[0]?.message;
  let content = typeof message?.content === "string" ? message.content : "";
  if (!content.trim() && typeof message?.reasoning === "string") {
    // Some providers put the entire answer in the reasoning field.
    content = message.reasoning;
  }
  if (!content.trim()) {
    // OpenRouter reports some model-side errors in an error field with HTTP 200.
    const detail =
      (payload as { error?: { message?: string } })?.error?.message ?? "empty completion";
    return { kind: "failed", failClass: "content", detail };
  }

  const json = extractJson(content);
  if (json === null) {
    return { kind: "failed", failClass: "content", detail: "completion contained no JSON object" };
  }
  const validated = validateParsedReceipt(json, groupCurrency);
  if (!validated.ok) {
    if (validated.notAReceipt) return { kind: "not_a_receipt" };
    return { kind: "failed", failClass: "content", detail: validated.error };
  }
  // OpenRouter includes usage.cost (USD) on every response; direct providers
  // without it leave the cost null.
  const usageCost = (payload as { usage?: { cost?: unknown } })?.usage?.cost;
  const costMicroUsd =
    typeof usageCost === "number" && Number.isFinite(usageCost)
      ? Math.round(usageCost * 1_000_000)
      : null;
  return { kind: "ok", receipt: validated.receipt, costMicroUsd };
}

/** Wire schema mirror for structured outputs (permissive: extra fields ok,
 *  every field nullable — the validator remains the authority). */
const RECEIPT_JSON_SCHEMA = {
  type: "object",
  properties: {
    merchant: { type: ["string", "null"] },
    purchased_at: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          raw_text: { type: ["string", "null"] },
          name: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit_price_minor: { type: ["integer", "null"] },
          total_price_minor: { type: ["integer", "null"] },
          category: { type: ["string", "null"] },
          tax_group: { type: ["string", "null"] },
          line_type: { type: ["string", "null"] },
        },
        required: ["name", "total_price_minor"],
      },
    },
    subtotal_minor: { type: ["integer", "null"] },
    tax_minor: { type: ["integer", "null"] },
    tip_minor: { type: ["integer", "null"] },
    discounts_minor: { type: ["integer", "null"] },
    total_minor: { type: ["integer", "null"] },
    second_total_minor: { type: ["integer", "null"] },
    second_total_currency: { type: ["string", "null"] },
    printed_rate: { type: ["number", "null"] },
    is_fiscal_receipt: { type: ["boolean", "null"] },
    confidence: { type: ["number", "null"] },
  },
  required: ["items", "total_minor"],
} as const;

function modelLadder(): string[] {
  const primary = process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const fallbacks = (process.env.OPENROUTER_FALLBACK_MODEL || DEFAULT_FALLBACK_MODELS.join(","))
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

export async function parseReceiptImage(
  image: Uint8Array,
  contentType: string,
  groupCurrency: string
): Promise<ParseOutcome> {
  // RECEIPT_API_KEY is the honest name when not on OpenRouter; the old
  // variable keeps working.
  const apiKey = process.env.RECEIPT_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, code: "no_api_key", error: PARSE_ERROR_MESSAGES.no_api_key };

  const dataUrl = `data:${contentType};base64,${Buffer.from(image).toString("base64")}`;

  const started = Date.now();
  let sawRateLimit = false;
  let contentDetail = "";
  let otherDetail = "";
  for (const model of modelLadder()) {
    if (Date.now() - started > TOTAL_BUDGET_MS) {
      console.error(`[receipt-parse] time budget exhausted before trying ${model}`);
      break;
    }
    const result = await attempt(model, apiKey, dataUrl, groupCurrency);
    if (result.kind === "ok") {
      const check = reconcile(result.receipt);
      return {
        ok: true,
        receipt: result.receipt,
        reconciles: check.ok,
        diffCents: check.diffCents,
        model,
        costMicroUsd: result.costMicroUsd,
        latencyMs: Date.now() - started,
      };
    }
    if (result.kind === "not_a_receipt") {
      return { ok: false, code: "not_a_receipt", error: PARSE_ERROR_MESSAGES.not_a_receipt };
    }
    if (result.kind === "rate_limited") {
      sawRateLimit = true;
      console.error(`[receipt-parse] ${model}: rate-limited`);
    } else {
      if (result.failClass === "content") contentDetail = result.detail;
      else otherDetail = result.detail;
      console.error(`[receipt-parse] ${model} failed (${result.failClass}): ${result.detail}`);
    }
  }

  // A model produced unusable output — the photo may be part of the problem.
  if (contentDetail) {
    const busyHint = sawRateLimit
      ? " (a backup model was busy, so trying again in a minute may also help)"
      : "";
    return {
      ok: false,
      code: "invalid_response",
      error: PARSE_ERROR_MESSAGES.invalid_response + busyHint,
      busyHint: sawRateLimit,
    };
  }
  if (sawRateLimit && !otherDetail) {
    return { ok: false, code: "rate_limited", error: PARSE_ERROR_MESSAGES.rate_limited };
  }
  return { ok: false, code: "provider_error", error: PARSE_ERROR_MESSAGES.provider_error };
}

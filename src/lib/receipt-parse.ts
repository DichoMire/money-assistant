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

const API_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "nvidia/nemotron-nano-12b-v2-vl:free";
const DEFAULT_FALLBACK_MODELS = [
  "dots-studio/dots-3-note-preview:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
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
  | { ok: true; receipt: ParsedReceipt; reconciles: boolean; diffCents: number; model: string }
  | { ok: false; code: ParseFailureCode; error: string };

export const PARSE_ERROR_MESSAGES: Record<ParseFailureCode, string> = {
  no_api_key: "Receipt scanning is not configured (missing OPENROUTER_API_KEY).",
  rate_limited: "The receipt service is rate-limited right now — try again in a minute.",
  provider_error: "The receipt service is unavailable right now — try again shortly.",
  invalid_response: "The receipt couldn't be read automatically. Try again, or use a sharper, tighter photo of just the receipt.",
  not_a_receipt: "This image doesn't look like a purchase receipt.",
};

type AttemptResult =
  | { kind: "ok"; receipt: ParsedReceipt }
  | { kind: "rate_limited" }
  | { kind: "not_a_receipt" }
  | { kind: "failed"; failClass: "http" | "network" | "content"; detail: string };

async function attempt(
  model: string,
  apiKey: string,
  imageDataUrl: string,
  groupCurrency: string
): Promise<AttemptResult> {
  let response: Response;
  let payload: unknown;
  try {
    response = await fetch(API_URL, {
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
  return { kind: "ok", receipt: validated.receipt };
}

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
  const apiKey = process.env.OPENROUTER_API_KEY;
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
    };
  }
  if (sawRateLimit && !otherDetail) {
    return { ok: false, code: "rate_limited", error: PARSE_ERROR_MESSAGES.rate_limited };
  }
  return { ok: false, code: "provider_error", error: PARSE_ERROR_MESSAGES.provider_error };
}

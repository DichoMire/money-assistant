/**
 * Server-side error reporting to Sentry via its envelope API — plain fetch,
 * no SDK (a deliberate deviation from RFC 11's @sentry/nextjs: the full SDK
 * brings build-tool integration risk for what this app needs, which is "a
 * production exception reaches the operator". Upgrade to the SDK when client
 * errors / tracing matter). DORMANT without SENTRY_DSN.
 *
 * PII scrub: only the error message/stack and the tags given here are ever
 * sent — never request bodies, never receipt bytes, never user emails.
 */

type ParsedDsn = { ingestUrl: string; publicKey: string };

function parseDsn(dsn: string): ParsedDsn | null {
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    if (!url.username || !projectId) return null;
    return {
      ingestUrl: `${url.protocol}//${url.host}/api/${projectId}/envelope/`,
      publicKey: url.username,
    };
  } catch {
    return null;
  }
}

/** Fire-and-forget; a monitoring failure must never affect the request. */
export function captureError(error: unknown, tags: Record<string, string> = {}): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const parsed = parseDsn(dsn);
  if (!parsed) return;
  try {
    const err = error instanceof Error ? error : new Error(String(error));
    const eventId = crypto.randomUUID().replace(/-/g, "");
    const timestamp = new Date().toISOString();
    const frames = (err.stack ?? "")
      .split("\n")
      .slice(1, 21)
      .map((line) => ({ function: line.trim().slice(0, 200) }))
      .reverse();
    const event = {
      event_id: eventId,
      timestamp,
      platform: "node",
      level: "error",
      environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
      tags,
      exception: {
        values: [
          {
            type: err.name,
            value: err.message.slice(0, 1000),
            stacktrace: frames.length > 0 ? { frames } : undefined,
          },
        ],
      },
    };
    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: timestamp, dsn }) +
      "\n" +
      JSON.stringify({ type: "event" }) +
      "\n" +
      JSON.stringify(event) +
      "\n";
    void fetch(parsed.ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body: envelope,
    }).catch(() => {});
  } catch {
    /* never throw from monitoring */
  }
}

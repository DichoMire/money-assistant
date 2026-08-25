/**
 * In-app-browser detection (RFC 05 §3.4). Conservative UA patterns — a false
 * positive costs one extra sentence on the login card, a false negative is
 * the status quo. Client-only (reads navigator.userAgent after mount).
 */

export type InAppBrowser = "viber" | "messenger" | "instagram" | "generic-webview";

export function detectInAppBrowser(ua: string): InAppBrowser | null {
  if (/Viber/i.test(ua)) return "viber";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "messenger";
  if (/Instagram/i.test(ua)) return "instagram";
  // The Android WebView token ("; wv)") — generic embedded browser.
  if (/;\s?wv\)/.test(ua)) return "generic-webview";
  return null;
}

/**
 * Best-effort "open this page in the real browser" URL.
 * Android: intent:// resolves to the default browser (must be a real
 * user-tapped anchor). iOS: x-safari-https is undocumented and unreliable —
 * offered as best effort alongside a copy-link fallback.
 */
export function browserEscapeUrl(href: string): { kind: "intent" | "x-safari" | null; url: string | null } {
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return { kind: null, url: null };
  }
  if (parsed.protocol !== "https:") return { kind: null, url: null };
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  if (/Android/i.test(ua)) {
    return {
      kind: "intent",
      url: `intent://${parsed.host}${parsed.pathname}${parsed.search}#Intent;scheme=https;end`,
    };
  }
  if (/iPhone|iPad|iPod/i.test(ua)) {
    return { kind: "x-safari", url: `x-safari-https://${parsed.host}${parsed.pathname}${parsed.search}` };
  }
  return { kind: null, url: null };
}

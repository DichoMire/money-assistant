"use client";

import { useEffect } from "react";

/** Known acquisition channels — anything else is ignored (RFC 10 §3.3). */
const REF_SLUGS = new Set([
  "reddit",
  "kaldata",
  "bgmamma",
  "fb-org",
  "fb-ads-a",
  "fb-ads-b",
  "blog",
  "summary-share",
]);

/**
 * Channel attribution LIGHT: a ?ref=<slug> on a public URL sets a 30-day
 * first-party cookie; FIRST TOUCH WINS (discovery is what's being measured —
 * an existing value is never overwritten). users.signup_ref is written once
 * on the first authenticated dashboard render. No rewards, no third-party
 * calls, no identifier — the no-consent-banner status is untouched.
 */
export function LandingRefCapture() {
  useEffect(() => {
    try {
      const ref = new URLSearchParams(window.location.search).get("ref");
      if (!ref || !REF_SLUGS.has(ref)) return;
      if (document.cookie.split("; ").some((c) => c.startsWith("ref="))) return;
      document.cookie = `ref=${ref}; path=/; max-age=${30 * 86400}; samesite=lax`;
    } catch {}
  }, []);
  return null;
}

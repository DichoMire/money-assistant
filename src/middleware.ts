import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce CSP (Next.js reads the nonce from the request's CSP
 * header and stamps it onto its own inline scripts). Ships REPORT-ONLY by
 * default; set CSP_ENFORCE=1 after a clean soak (no violations across
 * login -> create group -> invite/join -> expenses -> scan -> settle) to
 * flip to enforcing. If a violation source can't be nonce-fixed quickly,
 * stay report-only rather than shipping a loose enforced policy.
 *
 * Notes:
 * - The app is fully dynamic (every page awaits auth()), so nonces cost
 *   nothing. A future STATIC public page must be excluded from the matcher
 *   or use hash-based CSP instead.
 * - img-src allows Google avatar hosts (sign-in profile images).
 * - 'unsafe-eval' is dev-only (React Fast Refresh needs it).
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://*.googleusercontent.com`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `form-action 'self'`,
    `base-uri 'self'`,
    `object-src 'none'`,
  ].join("; ");

  const headerName =
    process.env.CSP_ENFORCE === "1"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(headerName, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(headerName, csp);
  return response;
}

export const config = {
  matcher: [
    {
      // API routes serve no HTML; static assets need no nonce.
      source: "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon-|apple-touch-icon).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};

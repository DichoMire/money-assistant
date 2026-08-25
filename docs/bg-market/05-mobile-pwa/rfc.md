# RFC 05 — Installable PWA, Offline Shell & Webview-Proof Invites

> **Status update (2026-08-26):** stage 1 (manifest/icons, 2026-08-24; icons regenerated with the € mark) and **stage 2 (webview escape hint on /login + pre-auth /join)** implemented. Stages 3–7 (service worker/offline, install prompt, push foundation, screenshots, dark mode) **deferred by owner decision** in the release-prep planning round. Details: [IMPLEMENTATION-LOG.md](../IMPLEMENTATION-LOG.md).

> Part of the [Bulgarian market improvement guide](../README.md).
> **Status:** Proposed · **Priority: P2** — after correctness ([RFC 01](../01-euro-transition/rfc.md))
> and localization (RFC 02), **before** the growth push ([topic 10](../10-growth-marketing/research.md)):
> install polish and a webview-proof invite funnel are what growth traffic will land on.
> **Audience:** a future LLM implementer with full repo access. Read [research.md](research.md)
> and [00-current-state-audit.md §4](../00-current-state-audit.md) first. File/line references
> are to commit `14963d2`; re-locate by symbol name if drifted.
> **Owner constraint:** the product is **web-only for now** — a native/wrapped app is explicitly
> deferred. This RFC is the ceiling of "app-likeness", not a step toward a wrapper.

## 1. Problem

1. **Not installable at all.** There is no web app manifest anywhere (no `src/app/manifest.ts`,
   no `public/manifest.json`), no service worker, no offline behavior. Lighthouse installability
   fails at step zero.
2. **No app icons.** [public/](../../../public/) contains only the five stock create-next-app
   SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`); the only real icon is
   [src/app/favicon.ico](../../../src/app/favicon.ico). No 192/512 PNGs, no maskable icon, no
   `apple-touch-icon` — an iOS "Add to Home Screen" today produces a page-screenshot tile.
3. **No PWA metadata.** [src/app/layout.tsx](../../../src/app/layout.tsx) exports only
   `viewport.themeColor: "#ffffff"` + `viewportFit: "cover"`; there is no `appleWebApp`
   metadata, no apple icon link, no manifest link.
4. **The Viber invite funnel can dead-end.** Invites are copy-link only (audit §1.3) and will be
   opened inside Viber's in-app browser in Bulgaria. `/join/<token>`
   ([src/app/join/[token]/page.tsx:12](../../../src/app/join/%5Btoken%5D/page.tsx)) redirects
   logged-out visitors to `/login`, where production auth is **Google-only**
   ([src/auth.ts](../../../src/auth.ts)); Google returns `403: disallowed_useragent` in
   WebView-based in-app browsers (research §5). No detection, no escape affordance exists.
5. **Light-only UI.** [src/app/globals.css](../../../src/app/globals.css) defines five light
   tokens; components use literal `bg-white`/`text-gray-*` utilities throughout; no
   `prefers-color-scheme` handling (audit §4).

## 2. Goals / non-goals

**Goals**
- G1. Installable: Lighthouse installability passes; Android Chrome installs a WebAPK with the
  brand icon; iOS Add-to-Home-Screen renders a proper icon and opens standalone.
- G2. Minimal, safe offline: precached shell + static assets, network-first pages with a visible
  staleness/offline state, designed offline fallback page — and a hard guarantee that **server
  actions and `/api/*` are never served from cache**.
- G3. A custom install affordance: Chromium `beforeinstallprompt` capture + an iOS instructions
  sheet — shown to returning users, never on first visit, never inside a webview.
- G4. In-app-browser detection with an "open in your browser" escape on `/login` and
  `/join/[token]` specifically (the Viber + Google-OAuth problem).
- G5. Push-notification **foundation only**: SW `push`/`notificationclick` handlers and
  subscription plumbing land here; everything about *what/when/whether* to send is Topic 07's.
- G6. Dark mode via CSS custom properties + `prefers-color-scheme`, scoped honestly as the
  globals.css token refactor it actually is.

**Non-goals**
- Native app or Capacitor/TWA wrapper — **explicitly deferred by the owner**; revisit only on a
  separate decision.
- Notification triggers, content, preferences, email delivery — RFC 07 (../07-notifications/).
- Invite-share content: OG tags, Viber link previews, Web Share API, QR codes — topic 10's RFC.
- Offline expense entry / queued mutations / Background Sync — documented future work
  (research §4); the server-action architecture has no client model to queue against.
- iOS per-device `apple-touch-startup-image` splash matrix — poor cost/benefit (research §2).
- Replacing Google-only auth (the *root* fix for the webview trap) — Topic 06; this RFC only
  mitigates.

## 3. Design

### 3.1 Manifest + icon set (G1)

**Icon spec.** The brand tile already exists as CSS: a rounded square in `--brand` `#1cc29f`
with a bold white `$` ([src/app/login/page.tsx:27-32](../../../src/app/login/page.tsx),
[src/components/AppHeader.tsx:12-17](../../../src/components/AppHeader.tsx)). Reproduce it as a
single SVG master (flat `#1cc29f`, white bold `$` centered, glyph within the center 80%),
then export:

| File | Size | Notes |
|---|---|---|
| `public/icon-192.png` | 192×192 | `purpose: any`, rounded-square artwork |
| `public/icon-512.png` | 512×512 | `purpose: any`; also feeds Android splash |
| `public/icon-512-maskable.png` | 512×512 | **full-bleed** `#1cc29f` background, `$` inside center 80% safe zone, `purpose: maskable` |
| `public/apple-touch-icon.png` | 180×180 | opaque, **square, no pre-rounded corners** (iOS rounds) |

Delete the five stock SVGs from `public/` in the same change. Regenerate `favicon.ico` from the
master if it doesn't already match. If branding later moves from `$` to `€` (plausible for the
market), regenerate the whole set + the CSS tiles together — icon and in-app tile must stay identical.

**`src/app/manifest.ts`** (App Router convention — auto-linked, served as a cached route
handler; keep it **static**, do not read the locale cookie):

```ts
import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Money Assistant",
    short_name: "Money Assistant",
    description: "Split group expenses and settle up", // brand name is locale-neutral; static EN description
    start_url: "/",
    display: "standalone",
    background_color: "#f4f6f8", // --background
    theme_color: "#ffffff",      // matches viewport.themeColor
    lang: "en",
    dir: "ltr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    // screenshots: added in stage 6 once the UI is stable (richer install UI)
  };
}
```

**`src/app/layout.tsx` additions** in `generateMetadata()` / `viewport`:
- `appleWebApp: { capable: true, title: "Money Assistant", statusBarStyle: "default" }`
- `icons: { apple: "/apple-touch-icon.png" }`
- Leave `viewport` as-is in this stage (dark `themeColor` variant comes with 3.6).

### 3.2 Minimal service worker (G2)

**Tooling choice: Serwist**, the maintained next-pwa successor (research §1). Caveat: the build
uses Turbopack (`next build --turbopack`, [package.json](../../../package.json)), so use the
**`@serwist/turbopack`** integration (⚠️ newer — verify current Serwist docs). **Fallback
decision pre-made:** if the Turbopack integration proves flaky, do NOT switch the build to
webpack for this feature's sake — hand-roll a ~100-line versioned SW in `public/sw.js` with the
identical caching policy below. The policy, not the tool, is the contract.

**Caching policy — deliberately minimal:**

| Request class | Strategy |
|---|---|
| Precache: build assets (`/_next/static/*`), fonts, icons, `/offline` page | Cache-first (hashed/immutable; Serwist precache manifest handles revisioning) |
| GET navigations (pages) | **Network-first**; on network failure serve the cached copy of that page if one exists, else `/offline`. Any cache-served page must render with the offline banner (below) |
| POST anything (all server actions are POSTs) | **Never intercepted, never cached** — explicit `NetworkOnly` / pass-through |
| `/api/*` — auth (`/api/auth/*`), receipt images (`/api/receipts/*/image` is private per-member content), cron | **Never cached** — explicit deny-list |

- SW registration in a tiny client component mounted from `layout.tsx`
  (skip in development). `skipWaiting` + `clientsClaim` on: with a cache scope this small,
  instant activation is safer than stranded old SWs.
- **Offline signal:** a small client component (e.g. `OfflineBanner`) using
  `navigator.onLine` + `online`/`offline` events renders a persistent localized banner
  ("Няма връзка — данните може да не са актуални" / "You're offline — data may be out of date").
  This is the correctness guardrail for network-first: a cached balance sheet must never look live.
- **`/offline` page** (`src/app/offline/page.tsx`): static, both-locale text (it's precached
  once, so render both languages or pick by cookie client-side), brand tile, "retry" button.
- **Kill switch (document in the code):** the recovery path for a bad SW in production is
  deploying a no-op SW that calls `self.registration.unregister()` + clears caches. Write this
  file (`scripts/` or a comment with the exact snippet) *before* it's ever needed.

### 3.3 Custom install prompt (G3)

New client component `src/components/InstallPrompt.tsx`, mounted on the dashboard
([src/app/page.tsx](../../../src/app/page.tsx)):

- **Chromium branch:** capture `beforeinstallprompt` (`preventDefault()`, stash), render a
  dismissible card ("Install Money Assistant — works like an app, opens from your home screen");
  CTA calls `.prompt()`. Listen for `appinstalled` → set a permanent done-flag.
- **iOS branch:** if iOS Safari && `!navigator.standalone` &&
  `!matchMedia("(display-mode: standalone)").matches` → the card opens the existing
  [Modal](../../../src/components/Modal.tsx) bottom sheet with two illustrated steps:
  Share icon → "Add to Home Screen" (localized; Bulgarian: «Сподели» → «Добави към начален екран»).
- **Gating (all localStorage, no schema changes):**
  - session counter incremented once per calendar day of visit; show nothing before the
    **2nd distinct day**, and only for users with ≥1 group (prop from the dashboard's data).
  - dismiss → 30-day snooze; max 3 lifetime shows; `appinstalled`/standalone → never again.
  - **never render when in-app-browser detection (3.4) is positive** or when already standalone.
- i18n: new `install.*` keys, EN + BG, in [src/lib/i18n.ts](../../../src/lib/i18n.ts).

### 3.4 In-app browser detection + escape (G4)

New `src/lib/inapp.ts` (client-only helpers):

```ts
export function detectInAppBrowser(ua: string): "viber" | "messenger" | "instagram" | "generic-webview" | null
// Conservative patterns: /Viber/i, /FBAN|FBAV|FB_IAB/i, /Instagram/i, /; wv\)/ (Android WebView token).
export function browserEscapeUrl(href: string): { kind: "intent" | "x-safari" | null; url: string | null }
// Android: `intent://${host}${path}#Intent;scheme=https;end`   (must be a real user-tapped <a>)
// iOS:     `x-safari-https://${host}${path}`                    (⚠️ unreliable; best-effort)
```

New client component `OpenInBrowserHint`, rendered on exactly two pages
(both are server components — the hint is a client island that reads `navigator.userAgent`
after mount, so it's SSR-safe and invisible to normal browsers):

- **`/login`** ([src/app/login/page.tsx](../../../src/app/login/page.tsx)) — the critical
  surface: every Viber-opened invite for a logged-out user lands here via the
  `callbackUrl` redirect. Place the hint **above the Google button**.
- **`/join/[token]`** ([src/app/join/[token]/page.tsx](../../../src/app/join/%5Btoken%5D/page.tsx)) —
  belt-and-braces for the rare in-webview session that is somehow authenticated.

Hint content (new `inapp.*` i18n keys, EN + BG): "Google sign-in may not work inside
{Viber/Messenger/this app}. Open in your browser:" + (a) on Android, a prominent
`intent://` anchor ("Open in browser"); (b) on iOS, the `x-safari-https` anchor as best-effort
**plus** a copy-link button (reuse the clipboard pattern from the invite flow) and the
instruction "or tap the menu and choose Open in browser". **Do not hide or disable the Google
button** — some in-app browsers (Custom-Tab/SFSafariViewController-based) work fine; the hint
warns, the user decides. ⚠️ Viber's actual engine per platform is unverified — this design is
robust to either outcome, but test the real flow on-device (research §5) and keep the UA list
easy to extend.

### 3.5 Push foundation only (G5) — boundary with RFC 07

**Lands in this RFC** (so that Topic 07 starts from working plumbing, and because iOS push
requires the installed-PWA context this RFC creates):

- SW `push` event handler (parse `{ title, body, url }` JSON payload → `showNotification` with
  the brand icon) and `notificationclick` handler (focus-or-open `url`).
- `push_subscriptions` table in [src/db/schema.ts](../../../src/db/schema.ts):
  `id, userId → users.id (cascade), endpoint (unique), p256dh, auth, userAgent, createdAt`
  + drizzle migration.
- Server actions `savePushSubscription` / `deletePushSubscription` (auth-guarded, upsert by
  endpoint), and a client helper that — **only from an explicit user gesture** — calls
  `Notification.requestPermission()` and `registration.pushManager.subscribe(...)`.
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` documented in
  [.env.example](../../../.env.example); a `scripts/push-test.ts` dev script that sends one test
  push to a given subscription (may use the `web-push` npm package as a **dev** dependency).

**Explicitly NOT here (RFC 07's):** any UI inviting users to enable notifications, any
production sender, triggers (new expense, settle-up nudge, invite accepted…), notification
preferences, digests, email fallback. Acceptance for this RFC is "a dev-subscribed browser
renders a test push" — production sends **zero** notifications after this RFC ships.

### 3.6 Dark mode (G6) — scoped honestly

This is a **token refactor with a dark palette at the end**, not a media query (research §6).
Two sub-stages, the first shipping with zero visual change:

1. **Semantic tokens.** Extend `:root` in [src/app/globals.css](../../../src/app/globals.css)
   with `--surface` (white), `--surface-muted` (gray-50), `--border` (gray-200/300),
   `--text-1` (gray-800/900), `--text-2` (gray-500), `--text-3` (gray-400), plus the existing
   five; map them through `@theme inline` so Tailwind v4 emits `bg-surface`, `text-t1`, …
   utilities. Then sweep every component replacing literal `bg-white` / `text-gray-*` /
   `border-gray-*` with the semantic classes (`.card`, `.btn-*`, `.input`, `.chip`, `.label` in
   globals.css; `Modal.tsx`, `AppHeader.tsx`, and the rest of `src/components/`). Verify
   pixel-identical light rendering before proceeding.
2. **Dark palette.** A single `@media (prefers-color-scheme: dark)` block redefining the tokens
   (dark surfaces, adjusted `--brand-dark`/`--owe` for AA contrast on dark, form-control scheme
   via `color-scheme: light dark` on `:root`); change `viewport.themeColor` in `layout.tsx` to
   the array form with `media` keys, and revisit `background_color` in the manifest (keep light —
   Android splash follows the manifest, which cannot vary by scheme). System-following only;
   no manual toggle in this RFC (a toggle needs the user-settings surface Topic 06 introduces).

## 4. Implementation plan (ordered, independently shippable)

| Stage | Contents | Touches |
|---|---|---|
| 1 | Icon set + `manifest.ts` + apple/PWA metadata; delete stock SVGs | `public/`, `src/app/manifest.ts` (new), `src/app/layout.tsx` |
| 2 | Webview detection + escape hint on login/join | `src/lib/inapp.ts` (new), `src/components/OpenInBrowserHint.tsx` (new), `login/page.tsx`, `join/[token]/page.tsx`, `i18n.ts` |
| 3 | Service worker (Serwist/Turbopack, fallback hand-rolled) + `/offline` page + offline banner + kill-switch doc | `next.config.ts`, `src/app/sw.ts` (new), `src/app/offline/page.tsx` (new), registration component, `package.json` |
| 4 | Install prompt (Chromium + iOS sheet) with engagement gating | `src/components/InstallPrompt.tsx` (new), `src/app/page.tsx`, `i18n.ts` |
| 5 | Push foundation: SW handlers, subscriptions table + actions, VAPID env, test script | `sw.ts`, `schema.ts` + migration, `actions.ts` (or new `push-actions.ts`), `.env.example`, `scripts/push-test.ts` |
| 6 | Richer install UI: BG-language `narrow` + `wide` screenshots in the manifest | `public/screenshots/`, `manifest.ts` |
| 7 | Dark mode: token sweep (7a, zero visual change) then dark palette + themeColor media (7b) | `globals.css`, most of `src/components/`, `layout.tsx` |

Stage 1 alone already fixes iOS Add-to-Home-Screen; stages 1+3 make Chromium fully installable.
**Stage 2 is independent of everything and carries the most Bulgarian-market value — it may ship
first.** Stage 6 waits until the UI is visually stable (post-RFC 02 formatting changes).

## 5. Acceptance criteria

- **Installability:** Lighthouse reports the app installable; Chrome DevTools → Application →
  Manifest shows zero errors and a correct maskable preview. Android Chrome "Install app"
  produces a WebAPK: brand icon in the launcher, standalone open, splash from
  `background_color` + 512 icon.
- **iOS:** Safari → Share → Add to Home Screen renders the brand `$` tile (not a page
  screenshot); the installed app opens standalone (no Safari chrome); signing in with Google
  inside the installed app succeeds (separate cookie jar — being logged out on first launch is
  expected and not a failure).
- **Offline:** with the SW active, airplane mode → revisiting a previously loaded group shows
  the cached page **with the offline banner**, or the `/offline` page for uncached routes;
  reconnecting recovers without manual cache clearing. DevTools network log proves POSTs
  (server actions) and `/api/*` are never answered by the SW cache.
- **SW updates:** after a deploy, clients receive the new SW and fresh assets on next
  navigation (no stuck stale bundle); the documented kill-switch procedure exists in-repo.
- **Install prompt:** nothing on first visit; on a 2nd-day visit with ≥1 group, Chromium shows
  the custom card and `.prompt()` works; iOS shows the instruction sheet; nothing renders in a
  detected webview or in standalone mode; dismissal snoozes 30 days.
- **Viber flow (manual, real device — the flagship test):** send an invite link in a Viber chat
  → tap → in-app browser opens `/login` → the hint renders; on Android the `intent://` anchor
  opens the default browser at the same URL; completing Google login there lands on
  `/join/<token>` with the JoinCard; the copy-link fallback works on iOS. Normal Chrome/Safari
  visits never see the hint.
- **Push foundation:** `scripts/push-test.ts` delivers a visible notification to a
  dev-subscribed browser (desktop Chrome and, ⚠️ device permitting, an installed iOS PWA);
  clicking opens the payload URL; grep confirms no production code path calls the send helper.
- **Dark mode:** stage 7a ships with pixel-identical light UI; after 7b, toggling the OS scheme
  flips the app (both `<html>` background and browser chrome via `themeColor` media), money
  colors (`amount-pos`/`amount-neg`) pass AA on dark surfaces, and light mode is unchanged.
- `npm run lint`, `npm run build`, and the existing test scripts (`test:math`, `test:receipt`,
  `test:receipt-db`) all pass at every stage.

## 6. Risks & alternatives considered

- **SW caching bugs corrupting freshness — the top risk.** A splitting app that shows stale
  balances is *wrong*, not just slow. Mitigations are the design: minimal cache scope (static
  assets + navigations only), network-first, explicit deny-list for POST/`/api/*`, versioned
  precache with immediate activation, the always-on offline banner for cache-served content,
  and a pre-written kill-switch SW. Alternative considered: no navigation caching at all
  (offline page only) — acceptable retreat if any staleness bug survives testing; the offline
  *shell* is the non-negotiable part, cached *pages* are not.
- **`@serwist/turbopack` immaturity** ⚠️ — fallback is the hand-rolled `public/sw.js` with the
  same policy (pre-decided in 3.2, so the implementer doesn't burn time fighting tooling).
- **`beforeinstallprompt` is non-standard** (Chromium-only, could change) — the component
  degrades to nothing when the event never fires; iOS path is independent of it.
- **UA-sniffing false positives/negatives** — conservative patterns, dismissible hint, Google
  button never blocked; a false positive costs one extra sentence on the login card, a false
  negative costs no more than today's status quo.
- **Viber engine uncertainty** ⚠️ — the design works whether Viber's browser blocks OAuth or
  not; the real-device test in §5 settles it. If Viber turns out OAuth-safe, keep the hint for
  Messenger/Instagram traffic anyway (Facebook is BG's #2 channel).
- **iOS standalone cookie-jar isolation** — users who install must log in once more inside the
  app; documented as expected in §5. No mitigation exists in a cookie-session PWA.
- **Dark-mode regression surface** — the class sweep touches nearly every component; mitigated
  by the two-substage split (7a provably pixel-identical before 7b flips anything).
- **Alternative rejected: TWA/Capacitor wrapper to reach the Play Store** — contradicts the
  owner's explicit web-only decision; revisit as its own topic if the decision changes.
- **Alternative rejected: localizing the manifest via cookie locale** — `manifest.ts` is a
  cached route handler; making it dynamic breaks caching for near-zero gain (the brand name is
  locale-neutral; install-UI strings are what users actually see, and those are the browser's).

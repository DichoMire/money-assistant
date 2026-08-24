# Topic 05 — Mobile Experience & PWA: Research

> Part of the [Bulgarian market improvement guide](../README.md).
> Research date: **2026-08-24**. Companion implementation plan: [rfc.md](rfc.md).
> Current-state findings: [00-current-state-audit.md §4](../00-current-state-audit.md).
> Claims that could not be verified are flagged ⚠️.

**Product calibration:** the owner has decided the app is **web-only for now** — no native app,
maybe later. That makes PWA/installability the *ceiling* of this topic, not a stepping stone.
Every competitor that matters (Splitwise, Tricount, Settle Up) is a native app; the compensating
weapon is app-like web polish: an icon on the home screen, standalone display, an offline page
that isn't a Chrome dinosaur, and a share/invite flow that survives **Viber's in-app browser** —
the default landing environment for links in Bulgaria
([10-growth-marketing/research.md §3](../10-growth-marketing/research.md)).

The responsive foundation is already strong (bottom-sheet modals, safe-area insets, iOS keyboard
handling — audit §4). What's missing is everything *above* responsiveness: there is **no manifest,
no service worker, no icons beyond `src/app/favicon.ico`**, and `public/` still holds the five
stock create-next-app SVGs.

---

## 1. Installability requirements in 2026

### Chrome/Chromium criteria (Android + desktop)
- HTTPS + a valid web app manifest with: `name` (or `short_name`), `icons` including **192×192
  and 512×512 PNG**, `start_url`, and `display` one of `standalone` / `fullscreen` /
  `minimal-ui` (or `window-controls-overlay`).
- **A service worker is no longer required for install** — Chrome dropped the
  fetch-handler requirement in Chrome 108 (mobile) / 112 (desktop) because sites were shipping
  empty `fetch` handlers just to pass the check; Chrome now supplies a default offline page for
  installed apps with no offline handling. The *ambient* install promotion (the automatic
  prompt/omnibox icon) still weighs engagement signals, so a SW + real offline page remains best
  practice, but installability itself is manifest-only.
- On Android, installing through Chrome mints a **WebAPK** — the app appears in the launcher and
  app settings like a native app.

### Manifest fields that matter beyond the minimum
- **`id`** — stable identity of the app independent of `start_url`; prevents duplicate installs
  when `start_url` changes. Use `"/"`.
- **Maskable icon** — Android launchers crop icons into circles/squircles; without a
  `purpose: "maskable"` 512px icon the logo is letterboxed in a white disc. Keep critical
  content inside the center **80% safe zone**, background full-bleed.
- **`theme_color` / `background_color`** — status-bar chrome and the auto-generated Android
  splash screen (background + 512px icon). iOS ignores both for splash (see §2).
- **`lang` / `dir`** — declare the manifest's own language; minor but free.
- **`screenshots` + `description` → "Richer Install UI"**: with ≥1 screenshot carrying
  `form_factor` (`narrow` for mobile, `wide` for desktop), Chrome replaces the mini infobar with
  a store-style install sheet (up to 5 screenshots on Android, 8 on desktop; each 320–3840px).
  Available since Chrome 94 (Android) / 108 (desktop). Cheap credibility for a no-app-store product.
- **`scope`** — everything under `/` here; default derived from `start_url` suffices.

### Next.js App Router conventions (project runs Next 15.5)
- **`app/manifest.ts`** (here: `src/app/manifest.ts`) exporting a default function returning
  `MetadataRoute.Manifest` is the built-in convention — Next serves it as a cached route handler
  and auto-injects `<link rel="manifest">`. No package needed. Note it is **cached/static**:
  reading the locale cookie to localize manifest strings would make it dynamic — keep it static.
- Icons: the manifest references files in `public/`; `apple-touch-icon` is added via the
  `metadata.icons.apple` field in `src/app/layout.tsx` (or an `app/apple-icon.png` file convention).

### Service-worker tooling state, 2026
- **`next-pwa` (original) is unmaintained**; its successor lineage is
  `@ducanh2912/next-pwa` (fork) → **Serwist** (`serwist` + `@serwist/next`), the de-facto
  standard Workbox-spirit toolchain for Next.js App Router. Current stable **v9.5.x**
  (v10 has been in preview since 2025 — prolonged; Turbopack support was backported to v9).
- **Turbopack caveat — directly relevant here:** this repo builds with `next build --turbopack`
  (`package.json`). `@serwist/next` is webpack-plugin-based; Serwist ships a separate
  **`@serwist/turbopack`** integration (wrap config with its `withSerwist`, plus `esbuild` as a
  dev dep) for Turbopack builds. ⚠️ Newer and less battle-tested than the webpack path — verify
  against current Serwist docs at implementation time.
- **Hand-rolled SW** remains entirely viable at this app's scope: a ~100-line
  `public/sw.js` with a versioned cache, network-first navigations and an offline fallback needs
  no build integration at all. Next's own PWA guide demonstrates exactly this. For a low-budget
  app wanting a *minimal* cache footprint, hand-rolled is a legitimate fallback if the Turbopack
  integration misbehaves.

## 2. iOS Safari PWA reality, 2026

- **No install prompt, ever.** No `beforeinstallprompt`, no ambient promotion. Install is
  manual: Safari → **Share → Add to Home Screen** (*«Добави към начален екран»*). Third-party
  browsers on iOS can now also add web apps to the home screen (iOS 16.4+ opens A2HS to them),
  but Safari is the flow worth documenting for users.
- **Icon:** the home-screen tile uses **`apple-touch-icon`** (180×180 PNG, opaque — iOS applies
  its own corner rounding; transparency becomes black). Without it, iOS renders a miniature page
  screenshot as the icon — the single most "amateur" signal a web app can send.
- **Standalone mode:** `display: standalone` in the manifest is honored; the app opens without
  Safari chrome. Quirks that matter:
  - The installed app has its **own storage/cookie jar**, separate from Safari — the user is
    logged out on first launch of the installed app and must sign in again there. Expected
    behavior, worth a UX note. OAuth redirects within a standalone web app work in-place on
    modern iOS. ⚠️ Behavior has shifted across iOS versions; test the Google flow on-device.
  - `window.navigator.standalone === true` (non-standard) and the
    `(display-mode: standalone)` media query both detect installed state.
- **EU / DMA status — verified:** in February 2024 Apple announced iOS 17.4 would *drop*
  Home Screen web apps in the EU (blaming DMA browser-engine requirements); after public and
  regulatory backlash Apple **reversed on 1 March 2024** — home-screen web apps stayed, EU
  included, running on WebKit regardless of default browser. As of 2026 they remain available in
  the EU; no subsequent removal found. Bulgaria is unaffected.
- **Web Push:** supported since **iOS/iPadOS 16.4 (March 2023), but only for installed
  home-screen web apps** — Safari tabs get nothing. Requires the app to be added to the home
  screen with standalone display and the permission request to come from a user gesture.
  iOS 17+ adds app-icon badging. ⚠️ One 2026 article claims EU-specific push restrictions on
  iOS PWAs; this contradicts the post-reversal record and no Apple source supports it — treat
  push as working in the EU but verify on a physical device.
- **Splash screens:** iOS **ignores** the manifest's `background_color`/icon splash generation.
  Real iOS splash screens require per-device-resolution `<link rel="apple-touch-startup-image">`
  images (a dozen-plus files, usually generated by tooling such as `pwa-asset-generator`).
  Low-budget verdict: skip them initially — the cost/benefit is poor; a brief blank launch frame
  is acceptable.

## 3. Install-prompt UX

- **`beforeinstallprompt` is Chromium-only and non-standard** (Chrome, Edge, Samsung Internet;
  never fired by Safari or Firefox). Pattern: `preventDefault()` the event, stash it, surface a
  custom "Install app" affordance, call `.prompt()` from a user gesture, listen for
  `appinstalled` to stop advertising.
- **iOS pattern:** since no event exists, the standard practice is an instructional
  affordance — detect iOS + Safari + not-standalone and show a small modal: "Tap **Share** →
  **Add to Home Screen**" with the share-icon glyph, localized. (The app's `Modal` bottom-sheet
  component is a natural fit.)
- **Conversion practices** (web.dev install-promotion patterns):
  - Never interrupt the first visit — prompt after demonstrated value (returning session,
    or right after a high-commitment moment such as joining a group).
  - Place the affordance contextually (header menu / settings / a dismissible card), keep it
    dismissible with a long snooze, and cap re-asks.
  - `getInstalledRelatedApps()` / `appinstalled` / `(display-mode: standalone)` gate repeat prompting.
  - ⚠️ No credible public 2026 benchmark for install-prompt conversion rates was found; numbers
    circulating on vendor blogs are marketing. Treat expected install rates as unknown-but-low
    (single-digit % of engaged users is the common anecdote).
- **Never show install UI inside an in-app browser** (§5) — installation is impossible there and
  the prompt is pure confusion.

## 4. Offline strategy — honest fit for THIS app

The app is fully server-rendered: RSC pages, server actions for every mutation, balances
**computed from the DB on each page load** (`src/lib/group-data.ts`) with no client-side data
store at all. That architecture dictates the offline verdict:

| Capability | Fit | Why |
|---|---|---|
| App shell + static assets cached | ✅ cheap | Hashed `_next/static` assets are immutable; fonts/icons likewise |
| "You're offline" fallback page | ✅ cheap | Static, localized, replaces the browser error page |
| Read-only last-seen group view | ⚠️ conditional | A network-first navigation cache replays the last HTML — acceptable **only** with a visible "offline — data may be stale" banner, because a cached balance sheet is a *wrong* balance sheet the moment anyone else adds an expense |
| Balances/settle correctness offline | ❌ no | Balances are server truth; there is no client model to recompute them |
| Queued (offline-entered) expenses | ❌ future | Requires Background Sync (Chromium-only anyway), client-side IDs, conflict resolution against concurrent edits, replay of server actions — a client state layer the app simply does not have. A genuine multi-week lift; **document as future, do not attempt in v1** |

**Right-sized scope for a low-budget web app:** precache the shell, network-first navigations
with an explicit staleness banner when served from cache, a designed offline page, and an
absolute **no-cache rule for server actions and `/api/*`** (auth, receipt images, cron). Anything
more sophisticated risks the worst failure mode a money app has: silently stale numbers
(see [rfc.md §6](rfc.md)). Notably, Settle Up's praised offline mode is native-app
infrastructure (Firebase sync) — not something a PWA replicates cheaply.

## 5. The in-app browser trap (Viber-first Bulgaria)

This is the highest-stakes finding of the topic. Viber holds ~90% messenger share claims in
Bulgaria ([10-growth-marketing/research.md §3](../10-growth-marketing/research.md)), and the
app's **only** invite mechanism is a copied link (audit §1.3) — which recipients will
overwhelmingly tap **inside Viber**, landing in its in-app browser, not in Chrome/Safari.

Two things break there:

1. **PWA install is impossible.** In-app browsers fire no `beforeinstallprompt`, have no
   Add-to-Home-Screen, and their sessions are throwaway.
2. **Google OAuth can hard-fail.** Google has blocked OAuth in embedded webviews since 2017,
   with enforcement tightened in 2021 and again July 2023: WebView-based user agents get
   **`403: disallowed_useragent`** on `accounts.google.com`. Since `/join/<token>` redirects
   logged-out visitors to `/login` (`src/app/join/[token]/page.tsx:12`) and production login is
   **Google-only** (`src/auth.ts`), a blocked webview means the *entire Viber invite funnel
   dead-ends* — the recipient cannot join at all.
   - Chrome Custom Tabs (Android) and `SFSafariViewController` (iOS) are real browsers and are
     allowed by Google; raw `WebView`/`WKWebView` shells are blocked.
   - ⚠️ Which of these Viber uses per platform is undocumented; Android messenger in-app
     browsers are typically WebView-based (Facebook/Messenger/Instagram famously are, and all
     trigger the 403). **Must be tested on a real device with Viber before and after launch** —
     the behavior can also change with Viber updates.
3. Viber has an "Open links internally" toggle (Settings → General) defaulting to internal, and
   its in-app browser menu offers an open-in-browser action. ⚠️ Menu wording/placement varies by
   version and platform — don't hardcode instructions to a specific label.

### Escape patterns (researched, all partial)
- **Detection:** UA sniffing only — no web API exposes "I am embedded". Viber's UA contains
  `Viber`; Messenger/Facebook use `FBAN`/`FBAV`/`FB_IAB`; Instagram says `Instagram`; generic
  Android WebViews carry the `; wv)` token. Keep patterns conservative (false positives show a
  scary banner in a fine browser).
- **Android:** an `intent://<host>/<path>#Intent;scheme=https;end` link asks Android itself to
  open the URL in the default browser — the most reliable escape, honored by most webviews, but
  it **requires a user gesture** (a tapped anchor, not a scripted redirect).
- **iOS:** `x-safari-https://<host>/<path>` opens Safari from *some* in-app browsers;
  ⚠️ unreliable and version-dependent. The dependable fallback is instructional: a prominent
  **copy-link button** + "open this in Safari/Chrome" hint (paste-in-browser always works
  because the invite is a plain bearer URL).
- Test harnesses exist for exactly this: `shalanah/inapp-debugger` and
  `luizcieslak/am-i-inapp-browser`.
- Adjacent mitigation (Topic 06's territory): any **second login method that is not
  OAuth-in-webview** (e.g. email magic link) makes the funnel webview-proof; noted here only as
  a cross-reference.

## 6. Dark mode as app-likeness

- The app is **light-only** today: `globals.css` defines five light tokens on `:root` and no
  `prefers-color-scheme` handling; `viewport.themeColor` is a single `#ffffff`.
- Native apps follow the OS theme; a stark-white page inside a dark-themed phone at a 23:00
  "who owes what for tonight" check is the moment a web app *feels* like a website. Mobile OS
  dark-mode adoption is majority-level ⚠️ (widely reported 55–80%+ in vendor surveys; no
  rigorous 2026 census — directionally safe, precisely unverifiable).
- Mechanics are standard and cheap *in principle*: token redefinition under
  `@media (prefers-color-scheme: dark)`, plus Next's `viewport.themeColor` array with `media`
  keys so the browser chrome flips too. Tailwind v4's `@theme inline` already maps the existing
  custom properties.
- **The honest cost is the refactor, not the media query:** components style themselves with
  literal Tailwind utilities (`bg-white`, `text-gray-800`, `border-gray-200` throughout `.card`,
  `.btn`, `Modal.tsx`, `AppHeader.tsx`, and nearly every component). Dark mode therefore means
  promoting those literals to semantic tokens (`--surface`, `--border`, `--text-1`…) across the
  whole component tree first — a mechanical but wide sweep — and only then flipping palettes.
  Scoped honestly in [rfc.md §3.6](rfc.md).

---

## Implications for the app

1. **Installability is nearly free value:** a `src/app/manifest.ts` + a real icon set (the
   brand tile — white "$" on `#1cc29f` — already exists as CSS on the login page) + an
   `apple-touch-icon` makes the app installable on Android and respectable on iOS *before any
   service worker exists*. This is the highest polish-per-hour item in the whole guide.
2. **Keep the service worker deliberately small:** static assets + network-first navigations +
   offline fallback, explicit no-cache for server actions and `/api/*`. Stale balances are worse
   than no offline mode. Serwist is the tool; its Turbopack integration is the open question.
3. **Offline expense queueing is a future project, not a v1 feature** — the server-action
   architecture has no client model to queue against. Say "you're offline" well instead.
4. **The Viber webview is a funnel-breaking risk, not a polish item.** Detection + escape
   affordances on `/login` and `/join/[token]` (Android `intent://` link, copy-link fallback,
   "open in browser" instructions) protect the app's only growth loop. Rank this above install
   prompts and dark mode.
5. **Install prompting must be custom and patient:** Chromium `beforeinstallprompt` capture +
   an iOS instructions sheet, shown to returning users only, never in webviews.
6. **Dark mode is worth doing but is a token refactor**, not a stylesheet addendum — schedule it
   as its own stage and pair it with `themeColor` media variants.
7. **Push notifications get their foundation here** (SW handlers + subscription plumbing —
   iOS requires the installed-PWA context this topic creates), while triggers/content/preferences
   belong to Topic 07 — the boundary is drawn in [rfc.md §3.5](rfc.md).

## Sources

<details><summary>Full source list (URLs)</summary>

- Installability criteria: https://developer.chrome.com/blog/update-install-criteria · https://web.dev/articles/install-criteria · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable · https://developer.chrome.com/docs/lighthouse/pwa/installable-manifest
- Manifest fields / icons / maskable: https://web.dev/learn/pwa/web-app-manifest · https://web.dev/articles/add-manifest · https://developer.mozilla.org/docs/Web/Manifest · https://logofoundry.app/blog/pwa-icon-requirements-safe-areas · https://markifo.com/requirements/pwa-icon-requirements
- Richer install UI: https://web.dev/patterns/web-apps/richer-install-ui · https://developer.chrome.com/blog/richer-pwa-installation · https://developer.chrome.com/blog/richer-install-ui-desktop
- Next.js manifest convention: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest · Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
- Serwist / next-pwa state: https://serwist.pages.dev/docs/next · https://serwist.pages.dev/docs/next/getting-started · https://www.npmjs.com/package/@serwist/next · https://www.npmjs.com/package/@serwist/turbopack · https://github.com/serwist/serwist/issues/54 · https://blog.logrocket.com/nextjs-16-pwa-offline-support/ · https://mikekubn.cz/blog/nextjs-app-router-sw · https://adropincalm.com/blog/nextjs-offline-service-worker/
- iOS PWA / push / splash: https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ · https://www.mobiloud.com/blog/progressive-web-apps-ios · https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide · https://brainhub.eu/library/pwa-on-ios · https://web.dev/learn/pwa/enhancements · https://gist.github.com/EvanBacon/7fd4dc3be3d00096579bb0b134c56ec7 · https://github.com/SeWiLio/pwa-asset-generator
- Apple EU/DMA reversal: https://developer.apple.com/support/dma-and-apps-in-the-eu/ · https://9to5mac.com/2024/02/15/ios-17-4-web-apps-european-union/ · https://www.gsmarena.com/apple_backtracks_wont_remove_progressive_web_apps_in_the_eu_after_all-news-61836.php · https://pushalert.co/blog/apple-reverses-decision-will-continue-to-support-home-screen-web-apps-in-the-eu/
- Install prompt UX: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event · https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/How_to/Trigger_install_prompt · https://web.dev/learn/pwa/installation-prompt/ · https://whatpwacando.today/installation/ · https://caniuse.com/mdn-api_window_beforeinstallprompt_event
- Google OAuth in webviews: https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/ · https://auth0.com/blog/google-blocks-oauth-requests-from-embedded-browsers/ · https://truelink-group.com/en/blog/why-google-login-fails-in-line-facebook-in-app-browsers-2026/ · https://docs.descope.com/auth-methods/oauth/customize/unsupported-webview-oauth
- In-app browser escape: https://paul.af/escape-in-app-browsers · https://paul.af/in-app-browsers-revisited · https://developer.chrome.com/docs/android/intents · https://github.com/shalanah/inapp-debugger · https://github.com/luizcieslak/am-i-inapp-browser · https://jhrun.com/2025/11/escape-in-app-browser-programmatically-introducing-a-zero-dependency-javascript-library/
- Viber link handling: https://www.hardreset.info/devices/apps/apps-viber/enable-open-links-internally/ · https://xdaforums.com/t/hyperlinks-on-viber.3815440/

</details>

**Key unverified items (⚠️):** Viber's in-app browser engine per platform (WebView vs Custom
Tabs / SFSafariViewController) and hence whether Google OAuth 403s there — must be device-tested;
`x-safari-https://` reliability; the claim of EU-specific iOS push restrictions (contradicted by
the DMA-reversal record); install-conversion benchmarks; dark-mode adoption percentages;
`@serwist/turbopack` maturity.

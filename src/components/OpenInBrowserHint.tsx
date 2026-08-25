"use client";

import { useEffect, useState } from "react";
import { browserEscapeUrl, detectInAppBrowser, type InAppBrowser } from "@/lib/inapp";
import { useT } from "./LocaleProvider";

const APP_LABELS: Record<InAppBrowser, string> = {
  viber: "Viber",
  messenger: "Messenger",
  instagram: "Instagram",
  "generic-webview": "",
};

/**
 * "Open in your browser" escape for in-app browsers (RFC 05 §3.4): Google
 * OAuth returns 403 disallowed_useragent inside WebView-based browsers —
 * exactly where Viber-shared invite links open. Renders nothing in normal
 * browsers (client island, checks the UA after mount — SSR-safe). The Google
 * button is never hidden: some in-app browsers work fine; the hint warns,
 * the user decides.
 */
export function OpenInBrowserHint() {
  const t = useT();
  const [state, setState] = useState<{
    app: InAppBrowser;
    escape: ReturnType<typeof browserEscapeUrl>;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const app = detectInAppBrowser(navigator.userAgent);
    if (app) setState({ app, escape: browserEscapeUrl(window.location.href) });
  }, []);

  if (!state) return null;
  const appName = APP_LABELS[state.app];

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-left text-xs text-amber-800">
      <p className="font-semibold">
        {appName
          ? t("inapp.warningNamed", { app: appName })
          : t("inapp.warningGeneric")}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {state.escape.url && (
          <a
            href={state.escape.url}
            className="rounded-md border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-800"
          >
            {t("inapp.openInBrowser")}
          </a>
        )}
        <button
          type="button"
          className="cursor-pointer rounded-md border border-amber-300 px-2.5 py-1 font-semibold"
          onClick={() => void copyLink()}
        >
          {copied ? t("payment.copied") : t("inapp.copyLink")}
        </button>
      </div>
      <p className="mt-1.5 text-amber-700/80">{t("inapp.menuHint")}</p>
    </div>
  );
}

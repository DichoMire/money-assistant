"use client";

import { useTransition } from "react";
import { setLocale } from "@/app/locale-actions";
import { LOCALES, type Locale } from "@/lib/i18n";
import { useLocale } from "./LocaleProvider";

const LABELS: Record<Locale, string> = { en: "EN", bg: "БГ" };

/** EN/БГ segmented switch; the choice is stored in a cookie and applies everywhere. */
export function LanguageToggle() {
  const locale = useLocale();
  const [pending, startTransition] = useTransition();

  const switchTo = (next: Locale) => {
    if (next === locale || pending) return;
    startTransition(() => {
      void setLocale(next);
    });
  };

  return (
    <div
      className={`flex overflow-hidden rounded-lg border border-gray-300 text-xs font-bold ${pending ? "opacity-60" : ""}`}
      role="group"
      aria-label="Language / Език"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          onClick={() => switchTo(l)}
          aria-pressed={locale === l}
          className={`cursor-pointer px-2.5 py-1.5 transition-colors ${
            locale === l ? "text-white" : "bg-white text-gray-500 hover:bg-gray-50"
          }`}
          style={locale === l ? { background: "var(--brand)" } : undefined}
        >
          {LABELS[l]}
        </button>
      ))}
    </div>
  );
}

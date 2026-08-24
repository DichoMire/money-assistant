"use client";

import { useState } from "react";
import { setShowBgnEquivalent } from "@/app/user-actions";
import { LanguageToggle } from "./LanguageToggle";
import { useT } from "./LocaleProvider";

export function AccountSettings({ showBgnEquivalent }: { showBgnEquivalent: boolean }) {
  const t = useT();
  // Optimistic mirror of the persisted preference so the switch feels instant.
  const [showBgn, setShowBgn] = useState(showBgnEquivalent);

  const toggle = (value: boolean) => {
    setShowBgn(value);
    void setShowBgnEquivalent(value);
  };

  return (
    <div className="space-y-5">
      <div className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-gray-800">{t("account.language")}</p>
          <LanguageToggle />
        </div>
      </div>

      <div className="card px-5 py-4">
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="min-w-0">
            <span className="block font-semibold text-gray-800">{t("account.showBgn")}</span>
            <span className="mt-0.5 block text-xs text-gray-400">{t("account.showBgnHint")}</span>
          </span>
          <span
            role="switch"
            aria-checked={showBgn}
            tabIndex={0}
            onClick={() => toggle(!showBgn)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(!showBgn);
              }
            }}
            className="relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors"
            style={{ background: showBgn ? "var(--brand)" : "#d1d5db" }}
          >
            <span
              className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
              style={{ left: showBgn ? 18 : 2 }}
            />
          </span>
        </label>
      </div>
    </div>
  );
}

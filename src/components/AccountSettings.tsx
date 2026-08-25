"use client";

import { LanguageToggle } from "./LanguageToggle";
import { useT } from "./LocaleProvider";

export function AccountSettings() {
  const t = useT();

  return (
    <div className="space-y-5">
      <div className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-gray-800">{t("account.language")}</p>
          <LanguageToggle />
        </div>
      </div>
    </div>
  );
}

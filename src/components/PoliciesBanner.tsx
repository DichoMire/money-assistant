"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { acknowledgePolicies } from "@/app/account-actions";
import { useT } from "./LocaleProvider";

/**
 * One-time "we published our terms & privacy policy" notice for existing
 * accounts (users.policies_accepted_at is null). Server-side stamp so the
 * dismissal follows the account across devices.
 */
export function PoliciesBanner() {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  const [pending, startTransition] = useTransition();
  if (hidden) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs text-amber-800 sm:px-4">
        <p>
          {t("policies.published")}{" "}
          <Link className="font-semibold underline" href="/terms">
            {t("account.termsOfService")}
          </Link>{" "}
          ·{" "}
          <Link className="font-semibold underline" href="/privacy">
            {t("account.privacyPolicy")}
          </Link>
        </p>
        <button
          type="button"
          className="shrink-0 cursor-pointer rounded-md border border-amber-300 px-2 py-1 font-semibold hover:bg-amber-100"
          disabled={pending}
          onClick={() => {
            setHidden(true);
            startTransition(() => {
              void acknowledgePolicies();
            });
          }}
        >
          {t("policies.gotIt")}
        </button>
      </div>
    </div>
  );
}

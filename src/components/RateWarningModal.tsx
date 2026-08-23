"use client";

import { useEffect, useState } from "react";
import { updateRatesNow } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { RATES_STALE_DAYS } from "@/lib/rates";
import type { GroupDto } from "@/lib/types";
import { Modal } from "./Modal";

/**
 * Shown when this group needs currency conversion but the daily rates cron has
 * not stored anything for more than a week (or has never run). Dismissal is
 * remembered per group for the browser session.
 */
export function RateWarningModal({ group }: { group: GroupDto }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `rate-warning-dismissed:${group.id}`;

  const relevant = group.rates.needsConversion && (group.rates.stale || group.rates.missingRate);

  useEffect(() => {
    if (!relevant) return;
    try {
      if (sessionStorage.getItem(storageKey)) return;
    } catch {
      // storage unavailable — still show the warning
    }
    setOpen(true);
  }, [relevant, storageKey]);

  if (!open) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(storageKey, "1");
    } catch {}
    setOpen(false);
  };

  const refresh = async () => {
    setBusy(true);
    setError(null);
    const result = await updateRatesNow();
    setBusy(false);
    if (result.ok) dismiss();
    else setError(result.ok === false ? result.error : null);
  };

  return (
    <Modal title="⚠️ Exchange rates are out of date" onClose={dismiss}>
      <div className="space-y-4 text-sm text-gray-600">
        <p>
          This group has bills in a currency other than {group.currency}, but{" "}
          {group.rates.latestDate ? (
            <>
              the newest stored exchange rate is from{" "}
              <span className="font-semibold">{formatDate(group.rates.latestDate)}</span> — older
              than {RATES_STALE_DAYS} days. The daily rate update job may not be running.
            </>
          ) : (
            <>no exchange rates have been stored yet, so converted amounts cannot be computed.</>
          )}
        </p>
        <p>
          Converted amounts{group.rates.latestDate ? " may be inaccurate" : " are unavailable"} until
          rates are refreshed.
        </p>
        {error && <p className="font-medium text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" className="btn btn-secondary" onClick={dismiss}>
            Dismiss
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void refresh()} disabled={busy}>
            {busy ? "Updating…" : "Update rates now"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

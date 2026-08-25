"use client";

import { useEffect, useState } from "react";
import { getMyPaymentProfile, savePaymentProfile } from "@/app/payment-actions";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";

/** "My payment details" entry form (RFC 03 §3.1) — IBAN + name, blink, Revolut. */
export function PaymentDetailsModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [loaded, setLoaded] = useState(false);
  const [iban, setIban] = useState("");
  const [accountName, setAccountName] = useState("");
  const [blinkPhone, setBlinkPhone] = useState("");
  const [revolutTag, setRevolutTag] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyPaymentProfile()
      .then((p) => {
        if (p) {
          setIban(p.iban ?? "");
          setAccountName(p.accountName ?? "");
          setBlinkPhone(p.blinkPhone ?? "");
          setRevolutTag(p.revolutTag ?? "");
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await savePaymentProfile({ iban, accountName, blinkPhone, revolutTag });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  };

  return (
    <Modal title={t("payment.myDetails")} onClose={onClose}>
      {!loaded ? (
        <p className="py-6 text-center text-sm text-gray-400">…</p>
      ) : (
        <div className="space-y-3">
          <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-700">
            {t("payment.detailsHint")}
          </p>
          <div>
            <label className="label" htmlFor="pd-iban">IBAN</label>
            <input
              id="pd-iban"
              className="input font-mono"
              autoComplete="off"
              spellCheck={false}
              placeholder="BG00 XXXX 0000 0000 0000 00"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="pd-name">{t("payment.accountName")}</label>
            <input
              id="pd-name"
              className="input"
              maxLength={70}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">{t("payment.accountNameHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="pd-blink">{t("payment.blinkPhone")}</label>
            <input
              id="pd-blink"
              className="input"
              inputMode="tel"
              placeholder="+359 88 …"
              value={blinkPhone}
              onChange={(e) => setBlinkPhone(e.target.value)}
            />
            <p className="mt-1 text-xs text-gray-400">{t("payment.blinkPhoneHint")}</p>
          </div>
          <div>
            <label className="label" htmlFor="pd-revolut">{t("payment.revolutTag")}</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-400">revolut.me/</span>
              <input
                id="pd-revolut"
                className="input flex-1"
                autoComplete="off"
                spellCheck={false}
                value={revolutTag}
                onChange={(e) => setRevolutTag(e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? t("common.saving") : t("account.save")}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

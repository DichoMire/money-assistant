"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteGroup, updateGroup } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import type { GroupDto } from "@/lib/types";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";

export function SettingsModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState(group.name);
  const [currency, setCurrency] = useState(group.currency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const result = await updateGroup(group.id, { name, currency });
    setBusy(false);
    if (result.ok) onClose();
    else setError(result.error);
  };

  const remove = async () => {
    if (!window.confirm(t("settings.deleteConfirm", { name: group.name }))) {
      return;
    }
    setBusy(true);
    const result = await deleteGroup(group.id);
    setBusy(false);
    if (result.ok) router.push("/");
    else setError(result.ok === false ? result.error : null);
  };

  return (
    <Modal title={t("settings.title")} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="set-name">{t("settings.groupName")}</label>
          <input id="set-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="set-currency">{t("settings.groupCurrency")}</label>
          <select id="set-currency" className="input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          {currency !== group.currency && (
            <p className="mt-1 text-xs text-amber-600">
              {t("settings.currencyNote", { currency })}
            </p>
          )}
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
          <button type="button" className="btn btn-secondary" onClick={onClose}>{t("common.cancel")}</button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !name.trim()}>
            {busy ? t("common.saving") : t("common.save")}
          </button>
        </div>

        <div className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-3">
          <p className="mb-2 text-xs font-semibold text-red-600 uppercase">{t("settings.dangerZone")}</p>
          <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
            {t("settings.deleteGroup")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

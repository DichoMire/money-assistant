"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createGroup } from "@/app/actions";
import { CURRENCIES } from "@/lib/currencies";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";

export function NewGroupForm() {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const result = await createGroup(name, currency);
    setBusy(false);
    if (result.ok && result.id) {
      setOpen(false);
      setName("");
      router.push(`/groups/${result.id}`);
    } else if (!result.ok) {
      setError(result.error);
    }
  };

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        {t("newGroup.button")}
      </button>
      {open && (
        <Modal title={t("newGroup.title")} onClose={() => setOpen(false)}>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div>
              <label className="label" htmlFor="group-name">
                {t("newGroup.name")}
              </label>
              <input
                id="group-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("newGroup.namePlaceholder")}
                autoFocus
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="group-currency">
                {t("newGroup.currency")}
              </label>
              <select
                id="group-currency"
                className="input"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
                {busy ? t("newGroup.creating") : t("newGroup.create")}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

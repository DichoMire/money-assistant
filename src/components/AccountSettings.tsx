"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteAccount,
  exportAccountData,
  getDeletionOverview,
  transferGroupOwnership,
  updateProfile,
} from "@/app/account-actions";
import { deleteGroup } from "@/app/actions";
import type { DeletionOverview } from "@/lib/types";
import { LanguageToggle } from "./LanguageToggle";
import { useT } from "./LocaleProvider";
import { Modal } from "./Modal";
import { PaymentDetailsModal } from "./PaymentDetailsModal";

export function AccountSettings({ user }: { user: { name: string; email: string } }) {
  const t = useT();
  const [name, setName] = useState(user.name);
  const [profileState, setProfileState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [profileError, setProfileError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);

  const saveProfile = async () => {
    setProfileState("saving");
    setProfileError(null);
    const result = await updateProfile(name);
    if (result.ok) {
      setProfileState("saved");
    } else {
      setProfileState("error");
      setProfileError(result.error);
    }
  };

  const doExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const result = await exportAccountData();
      if (!result.ok) {
        setExportError(result.error);
        return;
      }
      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `money-assistant-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="card px-5 py-4">
        <p className="mb-3 font-semibold text-gray-800">{t("account.profile")}</p>
        <label className="label" htmlFor="profile-name">
          {t("account.displayName")}
        </label>
        <div className="flex gap-2">
          <input
            id="profile-name"
            className="input flex-1"
            value={name}
            maxLength={80}
            onChange={(e) => {
              setName(e.target.value);
              setProfileState("idle");
            }}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={profileState === "saving" || name.trim() === user.name}
            onClick={() => void saveProfile()}
          >
            {profileState === "saving" ? "…" : t("account.save")}
          </button>
        </div>
        {profileState === "saved" && (
          <p className="mt-1 text-xs font-medium text-emerald-600">{t("account.saved")}</p>
        )}
        {profileError && <p className="mt-1 text-xs font-medium text-red-600">{profileError}</p>}
        <p className="mt-2 text-xs text-gray-400">{t("account.displayNameHint")}</p>
        <p className="mt-3 text-sm text-gray-500">
          <span className="font-medium text-gray-700">{t("account.email")}:</span> {user.email}
        </p>
      </div>

      <div className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-semibold text-gray-800">{t("account.language")}</p>
          <LanguageToggle />
        </div>
      </div>

      <div className="card px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-gray-800">{t("payment.myDetails")}</p>
            <p className="mt-0.5 text-xs text-gray-400">{t("payment.detailsHint")}</p>
          </div>
          <button
            type="button"
            className="btn btn-secondary shrink-0"
            onClick={() => setPaymentOpen(true)}
          >
            {t("payment.edit")}
          </button>
        </div>
      </div>

      <div className="card px-5 py-4">
        <p className="mb-1 font-semibold text-gray-800">{t("account.dataPrivacy")}</p>
        <p className="mb-3 text-xs text-gray-400">{t("account.exportHint")}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={exporting}
            onClick={() => void doExport()}
          >
            {exporting ? t("account.exporting") : t("account.export")}
          </button>
          <button
            type="button"
            className="btn-secondary !text-red-600"
            onClick={() => setDeleteOpen(true)}
          >
            {t("account.deleteAccount")}
          </button>
        </div>
        {exportError && <p className="mt-2 text-xs font-medium text-red-600">{exportError}</p>}
        <p className="mt-4 text-xs text-gray-400">
          <a className="underline hover:text-gray-600" href="/privacy">
            {t("account.privacyPolicy")}
          </a>{" "}
          ·{" "}
          <a className="underline hover:text-gray-600" href="/terms">
            {t("account.termsOfService")}
          </a>
        </p>
      </div>

      {paymentOpen && <PaymentDetailsModal onClose={() => setPaymentOpen(false)} />}
      {deleteOpen && (
        <DeleteAccountModal email={user.email} onClose={() => setDeleteOpen(false)} />
      )}
    </div>
  );
}

function DeleteAccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const t = useT();
  const [overview, setOverview] = useState<DeletionOverview | null>(null);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transferPick, setTransferPick] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      setOverview(await getDeletionOverview());
    } catch {
      setError(t("errors.somethingWentWrong"));
    }
  }, [t]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const resolveTransfer = async (groupId: string) => {
    const target = transferPick[groupId];
    if (!target) return;
    setBusy(true);
    setError(null);
    const result = await transferGroupOwnership(groupId, target);
    if (!result.ok) setError(result.error);
    await refresh();
    setBusy(false);
  };

  const resolveDelete = async (groupId: string) => {
    setBusy(true);
    setError(null);
    const result = await deleteGroup(groupId);
    if (!result.ok) setError(result.error);
    await refresh();
    setBusy(false);
  };

  const doDelete = async () => {
    setBusy(true);
    setError(null);
    const result = await deleteAccount(confirmEmail);
    // On success the server signs us out and redirects — this only runs on error.
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
    }
  };

  const conflicted = overview?.conflictedGroups ?? [];
  const armed = confirmEmail.trim().toLowerCase() === email.toLowerCase();

  return (
    <Modal title={t("account.deleteTitle")} onClose={onClose}>
      {overview === null ? (
        <p className="py-4 text-center text-sm text-gray-400">…</p>
      ) : conflicted.length > 0 ? (
        <div className="space-y-3">
          <p className="font-semibold text-gray-800">{t("account.deleteConflictTitle")}</p>
          <p className="text-sm text-gray-500">{t("account.deleteConflictHint")}</p>
          <ul className="space-y-3">
            {conflicted.map((g) => (
              <li key={g.id} className="rounded-lg border border-gray-200 p-3">
                <p className="mb-2 font-medium text-gray-800">{g.name}</p>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="input !w-auto flex-1"
                    value={transferPick[g.id] ?? ""}
                    onChange={(e) =>
                      setTransferPick((prev) => ({ ...prev, [g.id]: e.target.value }))
                    }
                  >
                    <option value="">{t("account.transferTo")}</option>
                    {g.members.map((m) => (
                      <option key={m.userId} value={m.userId}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy || !transferPick[g.id]}
                    onClick={() => void resolveTransfer(g.id)}
                  >
                    {t("account.transferOwnership")}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary !text-red-600"
                    disabled={busy}
                    onClick={() => void resolveDelete(g.id)}
                  >
                    {t("account.deleteGroupInstead")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="space-y-3">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-gray-600">
            <li>{t("account.deleteExplain1")}</li>
            <li>{t("account.deleteExplain2")}</li>
            <li className="font-medium text-gray-800">{t("account.deleteExplain3")}</li>
          </ul>
          <label className="label" htmlFor="confirm-email">
            {t("account.typeEmailToConfirm", { email })}
          </label>
          <input
            id="confirm-email"
            className="input"
            autoComplete="off"
            inputMode="email"
            value={confirmEmail}
            onChange={(e) => setConfirmEmail(e.target.value)}
          />
          {error && <p className="text-sm font-medium text-red-600">{error}</p>}
          <button
            type="button"
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-40"
            disabled={!armed || busy}
            onClick={() => void doDelete()}
          >
            {busy ? t("account.deleting") : t("account.deleteForever")}
          </button>
        </div>
      )}
    </Modal>
  );
}

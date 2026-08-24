"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useT } from "./LocaleProvider";

/** Compact localized confirmation dialog — replaces window.confirm. */
export function ConfirmModal({
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  message: string;
  /** Defaults to the localized "Delete". */
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  useEffect(() => {
    // Capture phase, so Escape closes only this dialog and never reaches a
    // Modal sitting underneath (its listener runs in the bubble phase).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="card w-full max-w-xs px-5 py-4" role="alertdialog" aria-modal="true">
        <p className="text-sm text-gray-700">{message}</p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn btn-secondary !py-1.5" onClick={onClose} autoFocus>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-danger !py-1.5"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel ?? t("common.delete")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Confirmation state helper: `ask(message, action, label?)` shows the dialog,
 * the action runs only on confirm. Render `confirmElement` somewhere in the
 * component's JSX.
 */
export function useConfirm(): {
  ask: (message: string, action: () => void, confirmLabel?: string) => void;
  confirmElement: ReactNode;
} {
  const [pending, setPending] = useState<{
    message: string;
    action: () => void;
    confirmLabel?: string;
  } | null>(null);

  return {
    ask: (message, action, confirmLabel) => setPending({ message, action, confirmLabel }),
    confirmElement: pending ? (
      <ConfirmModal
        message={pending.message}
        confirmLabel={pending.confirmLabel}
        onConfirm={pending.action}
        onClose={() => setPending(null)}
      />
    ) : null,
  };
}

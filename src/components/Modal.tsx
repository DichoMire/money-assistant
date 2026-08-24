"use client";

import { useEffect, type ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 max-sm:items-end max-sm:p-0 sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* On phones the card becomes a bottom sheet: full width, capped height
          with internal scrolling, rounded only at the top. Desktop keeps the
          centered floating card. */}
      <div
        className={`card my-8 flex w-full flex-col ${wide ? "max-w-lg" : "max-w-md"} overflow-hidden max-sm:my-0 max-sm:max-h-[92dvh] max-sm:max-w-none max-sm:!rounded-t-2xl max-sm:!rounded-b-none max-sm:animate-[sheet-in_0.25s_ease-out] max-sm:pb-[env(safe-area-inset-bottom)]`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-5 py-3">
          <h2 className="text-base font-bold text-gray-800">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md px-2 py-0.5 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            aria-label="Close"
          >
            &times;
          </button>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

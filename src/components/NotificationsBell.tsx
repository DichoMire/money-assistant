"use client";

import Link from "next/link";
import { useState } from "react";
import { getNotifications, markNotificationsRead } from "@/app/notification-actions";
import { formatDate } from "@/lib/format";
import { describeNotification } from "@/lib/notify";
import type { NotificationDto } from "@/lib/types";
import { useLocale, useT } from "./LocaleProvider";
import { Modal } from "./Modal";

/**
 * Header bell (RFC 07 §3.2): server-computed unread count, on-demand panel
 * listing the latest ~30 rows rendered in the viewer's locale; opening the
 * panel marks the listed rows read.
 */
export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const t = useT();
  const locale = useLocale();
  const [unread, setUnread] = useState(initialUnread);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDto[] | null>(null);
  const [error, setError] = useState(false);

  const openPanel = () => {
    setOpen(true);
    setItems(null);
    setError(false);
    getNotifications()
      .then((rows) => {
        setItems(rows);
        const unreadIds = rows.filter((r) => r.readAt === null).map((r) => r.id);
        if (unreadIds.length > 0) {
          setUnread(0);
          void markNotificationsRead(unreadIds);
        }
      })
      .catch(() => setError(true));
  };

  return (
    <>
      <button
        type="button"
        className="relative cursor-pointer rounded-lg px-1.5 py-1.5 text-lg leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600 sm:px-2"
        aria-label={t("notify.bellAria")}
        title={t("notify.bellAria")}
        onClick={openPanel}
      >
        🔔
        {unread > 0 && (
          <span
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ background: "var(--brand)" }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <Modal title={t("notify.title")} onClose={() => setOpen(false)}>
          {error ? (
            <p className="py-6 text-center text-sm text-red-600">{t("activity.loadError")}</p>
          ) : items === null ? (
            <p className="py-6 text-center text-sm text-gray-400">{t("activity.loading")}</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">{t("notify.none")}</p>
          ) : (
            <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/groups/${n.groupId}`}
                    onClick={() => setOpen(false)}
                    className={`block rounded-lg px-2 py-2.5 text-sm hover:bg-gray-50 ${
                      n.readAt === null ? "bg-emerald-50/50" : ""
                    }`}
                  >
                    <span className="text-gray-700">
                      {describeNotification(n.type, n.actorName, n.details, t)}
                    </span>
                    <span className="mt-0.5 block text-xs text-gray-400">
                      {n.groupName} · {formatDate(n.createdAt.slice(0, 10), locale)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}

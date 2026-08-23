"use client";

import { useEffect, useState } from "react";
import { getActivityLog } from "@/app/actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { ActivityEntryDto, GroupDto } from "@/lib/types";
import { Modal } from "./Modal";

function describe(entry: ActivityEntryDto): string {
  const d = entry.details;
  const s = (key: string) => String(d[key] ?? "?");
  const money = () => formatCents(Number(d.amountCents ?? 0), String(d.currency ?? "USD"));
  switch (entry.action) {
    case "group.created":
      return `created the group "${s("name")}"`;
    case "group.renamed":
      return `renamed the group from "${s("from")}" to "${s("to")}"`;
    case "group.currency_changed":
      return `changed the currency from ${s("from")} to ${s("to")}`;
    case "group.simplify_toggled":
      return `turned debt simplification ${d.on ? "on" : "off"}`;
    case "alias.added":
      return `added virtual member "${s("name")}"`;
    case "alias.renamed":
      return `renamed "${s("from")}" to "${s("to")}"`;
    case "alias.deleted":
      return `deleted virtual member "${s("name")}"`;
    case "alias.attached":
      return `attached "${s("aliasName")}" to ${s("accountName")} (${s("accountEmail")})${
        d.merged ? ", merging their histories" : ""
      }`;
    case "member.joined":
      return d.via === "circle"
        ? `added ${s("name")} (${s("email")}) from their circle`
        : `joined via invite link`;
    case "member.left":
      return "left the group";
    case "member.removed":
      return `removed ${s("name")} (${s("email")}) from the group`;
    case "invite.created":
      return `created an invite link (valid until ${formatDate(s("expiresAt"))})`;
    case "invite.revoked":
      return "revoked the invite link";
    case "expense.added":
      return `added "${s("description")}" — ${money()}`;
    case "expense.updated":
      return `edited "${s("description")}" — ${money()}`;
    case "expense.deleted":
      return `deleted "${s("description")}" — ${money()}`;
    case "payment.added":
      return `recorded a payment: ${s("fromName")} paid ${s("toName")} ${money()}`;
    case "payment.updated":
      return `edited a payment: ${s("fromName")} paid ${s("toName")} ${money()}`;
    case "payment.deleted":
      return `deleted a payment: ${s("fromName")} paid ${s("toName")} ${money()}`;
    default:
      return entry.action;
  }
}

function timestamp(iso: string): string {
  const time = new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(iso.slice(0, 10))}, ${time}`;
}

export function ActivityModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [entries, setEntries] = useState<ActivityEntryDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getActivityLog(group.id)
      .then(setEntries)
      .catch(() => setError("Could not load the activity log."));
  }, [group.id]);

  return (
    <Modal title="Activity" onClose={onClose} wide>
      {error ? (
        <p className="text-sm font-medium text-red-600">{error}</p>
      ) : entries === null ? (
        <p className="py-6 text-center text-sm text-gray-400">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="py-6 text-center text-sm text-gray-400">No activity yet.</p>
      ) : (
        <>
          <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
            {entries.map((entry) => (
              <li key={entry.id} className="flex gap-3 py-2 text-sm">
                <span className="w-28 shrink-0 pt-0.5 text-xs leading-tight text-gray-400">
                  {timestamp(entry.createdAt)}
                </span>
                <span className="min-w-0 flex-1 text-gray-600">
                  <span className="font-semibold text-gray-800">{entry.actorName}</span>{" "}
                  {describe(entry)}
                </span>
              </li>
            ))}
          </ul>
          {entries.length >= 200 && (
            <p className="mt-2 text-xs text-gray-400">Showing the latest 200 events.</p>
          )}
        </>
      )}
    </Modal>
  );
}

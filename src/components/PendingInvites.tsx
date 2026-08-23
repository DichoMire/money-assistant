"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, declineInvite } from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { PendingInviteDto } from "@/lib/types";

export function PendingInvites({ invites }: { invites: PendingInviteDto[] }) {
  const router = useRouter();
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (invites.length === 0) return null;

  const accept = async (token: string) => {
    setBusyToken(token);
    setError(null);
    const result = await acceptInvite(token);
    if (result.ok && result.id) {
      router.push(`/groups/${result.id}`);
    } else if (!result.ok) {
      setBusyToken(null);
      setError(result.error);
    }
  };

  const decline = async (token: string) => {
    setBusyToken(token);
    setError(null);
    await declineInvite(token);
    setBusyToken(null);
  };

  return (
    <div className="mb-6">
      <h2 className="mb-2 text-sm font-bold tracking-wide text-gray-500 uppercase">
        Pending invites
      </h2>
      <div className="space-y-2">
        {invites.map((invite) => (
          <div
            key={invite.token}
            className="card flex flex-wrap items-center gap-3 border-l-4 px-4 py-3"
            style={{ borderLeftColor: "var(--brand)" }}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-700">
                <span className="font-semibold">{invite.inviterName}</span> invited you to{" "}
                <span className="font-semibold">{invite.groupName}</span>
              </p>
              <p className="text-xs text-gray-400">Expires {formatDate(invite.expiresAt)}</p>
            </div>
            <button
              type="button"
              className="btn btn-primary !px-3 !py-1.5"
              disabled={busyToken === invite.token}
              onClick={() => void accept(invite.token)}
            >
              {busyToken === invite.token ? "…" : "Join"}
            </button>
            <button
              type="button"
              className="btn btn-secondary !px-3 !py-1.5"
              disabled={busyToken === invite.token}
              onClick={() => void decline(invite.token)}
            >
              Decline
            </button>
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm font-medium text-red-600">{error}</p>}
    </div>
  );
}

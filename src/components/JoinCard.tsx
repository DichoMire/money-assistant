"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite, declineInvite } from "@/app/actions";

export function JoinCard({
  token,
  groupName,
  inviterName,
  peopleCount,
}: {
  token: string;
  groupName: string;
  inviterName: string;
  peopleCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const join = async () => {
    setBusy(true);
    setError(null);
    const result = await acceptInvite(token);
    if (result.ok && result.id) {
      router.push(`/groups/${result.id}`);
    } else if (!result.ok) {
      setBusy(false);
      setError(result.error);
    }
  };

  const decline = async () => {
    setBusy(true);
    await declineInvite(token);
    router.push("/");
  };

  return (
    <div className="card w-full max-w-sm px-6 py-8 text-center">
      <span
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-bold text-white"
        style={{ background: "var(--brand)" }}
      >
        $
      </span>
      <p className="text-sm text-gray-500">
        <span className="font-semibold text-gray-700">{inviterName}</span> invited you to join
      </p>
      <h1 className="mt-1 text-2xl font-bold text-gray-800">{groupName}</h1>
      <p className="mt-1 text-sm text-gray-400">
        {peopleCount} {peopleCount === 1 ? "person" : "people"} in this group
      </p>
      {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
      <button
        type="button"
        className="btn btn-primary mt-6 w-full !py-2.5"
        onClick={() => void join()}
        disabled={busy}
      >
        {busy ? "Joining…" : "Accept invite"}
      </button>
      <button
        type="button"
        className="btn btn-secondary mt-2 w-full"
        onClick={() => void decline()}
        disabled={busy}
      >
        No thanks
      </button>
    </div>
  );
}

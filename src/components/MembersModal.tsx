"use client";

import { useState } from "react";
import { addAlias, deleteAlias, renameAlias } from "@/app/actions";
import type { GroupDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

export function MembersModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<{ ok: boolean } & { error?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
    return result.ok;
  };

  return (
    <Modal title="People in this group" onClose={onClose}>
      <div className="space-y-3">
        {group.aliases.length === 0 && (
          <p className="text-sm text-gray-500">
            Nobody here yet. Add the people whose expenses you want to track — including yourself,
            if you take part in the bills.
          </p>
        )}

        <ul className="max-h-72 space-y-1 overflow-y-auto">
          {group.aliases.map((a) => (
            <li key={a.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
              <Avatar id={a.id} name={a.name} size={30} />
              {editingId === a.id ? (
                <form
                  className="flex flex-1 gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (await run(() => renameAlias(a.id, editName))) setEditingId(null);
                  }}
                >
                  <input
                    className="input !py-1.5"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary !px-3 !py-1.5"
                    onClick={() => setEditingId(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">
                    {a.name}
                  </span>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    onClick={() => {
                      setEditingId(a.id);
                      setEditName(a.name);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="cursor-pointer rounded-md px-2 py-1 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
                    aria-label={`Remove ${a.name}`}
                    onClick={() => {
                      if (window.confirm(`Remove ${a.name} from the group?`)) {
                        void run(() => deleteAlias(a.id));
                      }
                    }}
                  >
                    ×
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>

        <form
          className="flex gap-2 border-t border-gray-100 pt-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run(() => addAlias(group.id, newName))) setNewName("");
          }}
        >
          <input
            className="input"
            placeholder="Add a person…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !newName.trim()}>
            Add
          </button>
        </form>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      </div>
    </Modal>
  );
}

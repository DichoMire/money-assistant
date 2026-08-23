"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addAlias,
  addCircleMember,
  attachAlias,
  createInviteLink,
  deleteAlias,
  getCircleForGroup,
  getInviteLink,
  leaveGroup,
  removeMember,
  renameAlias,
  revokeInvite,
} from "@/app/actions";
import { formatDate } from "@/lib/format";
import type { CircleUserDto, GroupDto, InviteLinkDto } from "@/lib/types";
import { Avatar } from "./Avatar";
import { Modal } from "./Modal";

export function MembersModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const router = useRouter();
  const isOwner = group.myRole === "owner";

  const [query, setQuery] = useState("");
  const [circle, setCircle] = useState<CircleUserDto[]>([]);
  const [link, setLink] = useState<InviteLinkDto | null>(null);
  const [linkLoaded, setLinkLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [newVirtualName, setNewVirtualName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [attachingId, setAttachingId] = useState<string | null>(null);
  const [attachTarget, setAttachTarget] = useState("");

  const reloadInviteData = useCallback(() => {
    if (!isOwner) return;
    void getCircleForGroup(group.id).then(setCircle).catch(() => {});
    void getInviteLink(group.id)
      .then((l) => {
        setLink(l);
        setLinkLoaded(true);
      })
      .catch(() => {});
  }, [group.id, isOwner]);

  useEffect(() => {
    reloadInviteData();
  }, [reloadInviteData]);

  const run = async (fn: () => Promise<{ ok: boolean } & { error?: string }>) => {
    setBusy(true);
    setError(null);
    const result = await fn();
    setBusy(false);
    if (!result.ok && result.error) setError(result.error);
    return result.ok;
  };

  const suggestions = circle.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return false;
    return c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q);
  });

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Could not copy — select the link text and copy it manually.");
    }
  };

  const virtualAliases = group.aliases.filter((a) => a.userId === null);

  return (
    <Modal title="People in this group" onClose={onClose} wide>
      <div className="space-y-5">
        {/* ---- Invite (owner only) ---- */}
        {isOwner && (
          <section>
            <p className="label">Invite people</p>
            <input
              className="input"
              placeholder="Search your circle by name or email…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setInfo(null);
              }}
            />
            {suggestions.length > 0 && (
              <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200">
                {suggestions.slice(0, 5).map((c) => (
                  <li key={c.userId} className="flex items-center gap-3 px-3 py-2">
                    <Avatar id={c.userId} name={c.name} size={28} />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="text-sm font-medium text-gray-700">{c.name}</span>{" "}
                      <span className="text-xs text-gray-400">{c.email}</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary !px-3 !py-1 !text-xs"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => addCircleMember(group.id, c.userId))) {
                          setQuery("");
                          setInfo(`${c.name} joined the group.`);
                          reloadInviteData();
                        }
                      }}
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() !== "" && suggestions.length === 0 && (
              <p className="mt-1 text-sm text-gray-500">
                No one in your circle matches. Share the invite link below instead.
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              Your circle is everyone you already share a group with — they can be added
              instantly. Anyone else joins through the invite link.
            </p>
            {info && <p className="mt-2 text-sm font-medium" style={{ color: "var(--brand-dark)" }}>{info}</p>}

            {/* Invite link */}
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">Invite link</p>
              {link ? (
                <>
                  <div className="mt-2 flex gap-2">
                    <input className="input !py-1.5 font-mono !text-xs" readOnly value={link.url} onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn btn-primary shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => void copyLink(link.url)}>
                      {copied ? "Copied!" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger shrink-0 !px-3 !py-1.5 !text-xs"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => revokeInvite(link.id))) reloadInviteData();
                      }}
                    >
                      Revoke
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    Anyone with this link can join until {formatDate(link.expiresAt)}.
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary mt-2"
                  disabled={busy || !linkLoaded}
                  onClick={async () => {
                    setBusy(true);
                    setError(null);
                    try {
                      setLink(await createInviteLink(group.id));
                    } catch {
                      setError("Could not create the link.");
                    }
                    setBusy(false);
                  }}
                >
                  Create invite link (valid 7 days)
                </button>
              )}
            </div>
          </section>
        )}

        {/* ---- Members ---- */}
        <section>
          <p className="label">Members ({group.members.length})</p>
          <ul className="space-y-1">
            {group.members.map((m) => {
              const alias = group.aliases.find((a) => a.id === m.aliasId);
              const isMe = m.userId === group.myUserId;
              return (
                <li key={m.userId} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <Avatar id={m.aliasId ?? m.userId} name={m.name} size={30} />
                  {alias && editingId === alias.id ? (
                    <form
                      className="flex flex-1 gap-2"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await run(() => renameAlias(alias.id, editName))) setEditingId(null);
                      }}
                    >
                      <input className="input !py-1.5" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                      <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy}>Save</button>
                      <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setEditingId(null)}>Cancel</button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-sm font-medium text-gray-700">{alias?.name ?? m.name}</span>{" "}
                        <span className="text-xs text-gray-400">{m.email}</span>
                      </span>
                      {m.isOwner && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          Owner
                        </span>
                      )}
                      {isMe && alias && (
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title="Change how you appear in this group"
                          onClick={() => {
                            setAttachingId(null);
                            setEditingId(alias.id);
                            setEditName(alias.name);
                          }}
                        >
                          Rename
                        </button>
                      )}
                      {isOwner && !m.isOwner && (
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold text-gray-400 hover:bg-red-50 hover:text-red-500"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(`Remove ${m.name} from the group? Their expense history stays as a virtual member.`)) {
                              void run(() => removeMember(group.id, m.userId)).then(() => reloadInviteData());
                            }
                          }}
                        >
                          Remove
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* ---- Virtual members ---- */}
        <section>
          <p className="label">Virtual members ({virtualAliases.length})</p>
          <p className="mb-1 text-xs text-gray-400">
            People without accounts — you track their share for them. When they join the group,
            use <span className="font-semibold">Attach</span> to hand their history to their account.
          </p>
          {virtualAliases.length === 0 && (
            <p className="text-sm text-gray-400">None yet.</p>
          )}
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {virtualAliases.map((a) => (
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
                    <input className="input !py-1.5" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                    <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy}>Save</button>
                    <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setEditingId(null)}>Cancel</button>
                  </form>
                ) : attachingId === a.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const target = group.members.find((m) => m.userId === attachTarget);
                      if (!target) return;
                      const merges = target.aliasId !== null;
                      const detail = merges
                        ? `Their expense histories will be merged into one person named "${a.name}".`
                        : `"${a.name}" and its history will become their identity in this group.`;
                      if (!window.confirm(`Attach ${a.name} to ${target.name} (${target.email})? ${detail}`)) return;
                      if (await run(() => attachAlias(a.id, attachTarget))) setAttachingId(null);
                    }}
                  >
                    <span className="shrink-0 truncate text-sm font-medium text-gray-700">{a.name} →</span>
                    <select
                      className="input !py-1.5"
                      value={attachTarget}
                      onChange={(e) => setAttachTarget(e.target.value)}
                      autoFocus
                    >
                      {group.members.map((m) => (
                        <option key={m.userId} value={m.userId}>
                          {m.name} ({m.email})
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy || !attachTarget}>
                      Attach
                    </button>
                    <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setAttachingId(null)}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-700">{a.name}</span>
                    {isOwner && (
                      <>
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title="Link this virtual member to a group member's account"
                          onClick={() => {
                            setEditingId(null);
                            setAttachingId(a.id);
                            setAttachTarget(group.members[0]?.userId ?? "");
                          }}
                        >
                          Attach
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          onClick={() => {
                            setAttachingId(null);
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
                  </>
                )}
              </li>
            ))}
          </ul>
          {isOwner && (
            <form
              className="mt-2 flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await run(() => addAlias(group.id, newVirtualName))) setNewVirtualName("");
              }}
            >
              <input
                className="input"
                placeholder="Add a virtual member…"
                value={newVirtualName}
                onChange={(e) => setNewVirtualName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !newVirtualName.trim()}>
                Add
              </button>
            </form>
          )}
        </section>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {/* ---- Leave (members only) ---- */}
        {!isOwner && (
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                if (window.confirm(`Leave "${group.name}"? Your expense history stays as a virtual member.`)) {
                  if (await run(() => leaveGroup(group.id))) router.push("/");
                }
              }}
            >
              Leave group
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

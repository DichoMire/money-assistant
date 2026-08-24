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
import { useLocale, useT } from "./LocaleProvider";
import { Modal } from "./Modal";

export function MembersModal({ group, onClose }: { group: GroupDto; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
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
      setError(t("members.couldNotCopy"));
    }
  };

  const virtualAliases = group.aliases.filter((a) => a.userId === null);

  return (
    <Modal title={t("members.title")} onClose={onClose} wide>
      <div className="space-y-5">
        {/* ---- Invite (owner only) ---- */}
        {isOwner && (
          <section>
            <p className="label">{t("members.invitePeople")}</p>
            <input
              className="input"
              placeholder={t("members.searchPlaceholder")}
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
                      <span className="text-xs text-gray-400 max-sm:block max-sm:truncate">{c.email}</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary !px-3 !py-1 !text-xs"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => addCircleMember(group.id, c.userId))) {
                          setQuery("");
                          setInfo(t("members.joinedInfo", { name: c.name }));
                          reloadInviteData();
                        }
                      }}
                    >
                      {t("members.add")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {query.trim() !== "" && suggestions.length === 0 && (
              <p className="mt-1 text-sm text-gray-500">{t("members.noCircleMatch")}</p>
            )}
            <p className="mt-1 text-xs text-gray-400">{t("members.circleHint")}</p>
            {info && <p className="mt-2 text-sm font-medium" style={{ color: "var(--brand-dark)" }}>{info}</p>}

            {/* Invite link */}
            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
              <p className="text-xs font-semibold text-gray-500 uppercase">{t("members.inviteLink")}</p>
              {link ? (
                <>
                  <div className="mt-2 flex gap-2 max-sm:flex-wrap">
                    <input className="input !py-1.5 font-mono !text-xs max-sm:!text-base" readOnly value={link.url} onFocus={(e) => e.target.select()} />
                    <button type="button" className="btn btn-primary shrink-0 !px-3 !py-1.5 !text-xs" onClick={() => void copyLink(link.url)}>
                      {copied ? t("members.copied") : t("members.copy")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger shrink-0 !px-3 !py-1.5 !text-xs"
                      disabled={busy}
                      onClick={async () => {
                        if (await run(() => revokeInvite(link.id))) reloadInviteData();
                      }}
                    >
                      {t("members.revoke")}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">
                    {t("members.linkValidUntil", { date: formatDate(link.expiresAt, locale) })}
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
                      setError(t("members.couldNotCreateLink"));
                    }
                    setBusy(false);
                  }}
                >
                  {t("members.createLink")}
                </button>
              )}
            </div>
          </section>
        )}

        {/* ---- Members ---- */}
        <section>
          <p className="label">{t("members.membersCount", { count: group.members.length })}</p>
          <ul className="space-y-1">
            {group.members.map((m) => {
              const alias = group.aliases.find((a) => a.id === m.aliasId);
              const isMe = m.userId === group.myUserId;
              return (
                <li key={m.userId} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-gray-50">
                  <Avatar id={m.aliasId ?? m.userId} name={m.name} size={30} />
                  {alias && editingId === alias.id ? (
                    <form
                      className="flex flex-1 gap-2 max-sm:flex-wrap"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (await run(() => renameAlias(alias.id, editName))) setEditingId(null);
                      }}
                    >
                      <input className="input !py-1.5" value={editName} onChange={(e) => setEditName(e.target.value)} autoFocus />
                      <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy}>{t("common.save")}</button>
                      <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setEditingId(null)}>{t("common.cancel")}</button>
                    </form>
                  ) : (
                    <>
                      <span className="min-w-0 flex-1 truncate">
                        <span className="text-sm font-medium text-gray-700">{alias?.name ?? m.name}</span>{" "}
                        <span className="text-xs text-gray-400 max-sm:block max-sm:truncate">{m.email}</span>
                      </span>
                      {m.isOwner && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">
                          {t("members.owner")}
                        </span>
                      )}
                      {isMe && alias && (
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                          title={t("members.renameSelfTooltip")}
                          onClick={() => {
                            setAttachingId(null);
                            setEditingId(alias.id);
                            setEditName(alias.name);
                          }}
                        >
                          {t("members.rename")}
                        </button>
                      )}
                      {isOwner && !m.isOwner && (
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-0.5 text-xs font-semibold text-gray-400 hover:bg-red-50 hover:text-red-500"
                          disabled={busy}
                          onClick={() => {
                            if (window.confirm(t("members.removeConfirm", { name: m.name }))) {
                              void run(() => removeMember(group.id, m.userId)).then(() => reloadInviteData());
                            }
                          }}
                        >
                          {t("members.remove")}
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
          <p className="label">{t("members.virtualCount", { count: virtualAliases.length })}</p>
          <p className="mb-1 text-xs text-gray-400">
            {t("members.virtualHint1")} <span className="font-semibold">{t("members.attach")}</span>{" "}
            {t("members.virtualHint2")}
          </p>
          {virtualAliases.length === 0 && (
            <p className="text-sm text-gray-400">{t("members.noneYet")}</p>
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
                    <button type="submit" className="btn btn-primary !px-3 !py-1.5" disabled={busy}>{t("common.save")}</button>
                    <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setEditingId(null)}>{t("common.cancel")}</button>
                  </form>
                ) : attachingId === a.id ? (
                  <form
                    className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-wrap"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const target = group.members.find((m) => m.userId === attachTarget);
                      if (!target) return;
                      const merges = target.aliasId !== null;
                      const detail = merges
                        ? t("members.attachMerges", { alias: a.name })
                        : t("members.attachBecomes", { alias: a.name });
                      const question = t("members.attachConfirm", {
                        alias: a.name,
                        name: target.name,
                        email: target.email,
                      });
                      if (!window.confirm(`${question} ${detail}`)) return;
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
                      {t("members.attach")}
                    </button>
                    <button type="button" className="btn btn-secondary !px-3 !py-1.5" onClick={() => setAttachingId(null)}>
                      {t("common.cancel")}
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
                          title={t("members.attachTooltip")}
                          onClick={() => {
                            setEditingId(null);
                            setAttachingId(a.id);
                            setAttachTarget(group.members[0]?.userId ?? "");
                          }}
                        >
                          {t("members.attach")}
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
                          {t("members.rename")}
                        </button>
                        <button
                          type="button"
                          className="cursor-pointer rounded-md px-2 py-1 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
                          aria-label={t("members.removeAria", { name: a.name })}
                          onClick={() => {
                            if (window.confirm(t("members.removeAliasConfirm", { name: a.name }))) {
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
                placeholder={t("members.addVirtualPlaceholder")}
                value={newVirtualName}
                onChange={(e) => setNewVirtualName(e.target.value)}
              />
              <button type="submit" className="btn btn-primary shrink-0" disabled={busy || !newVirtualName.trim()}>
                {t("members.add")}
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
                if (window.confirm(t("members.leaveConfirm", { name: group.name }))) {
                  if (await run(() => leaveGroup(group.id))) router.push("/");
                }
              }}
            >
              {t("members.leaveGroup")}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

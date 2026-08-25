import { randomBytes } from "node:crypto";

/** 30 days: trips are planned weeks ahead; regenerate + revoke cover the
 *  security delta of the longer bearer-token window (RFC 06 §3.e). */
export const INVITE_TTL_DAYS = 30;

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function inviteExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

/** Absolute base URL of the deployed app — used for invite links, share
 *  payloads, emails, and site metadata. */
export function appBaseUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

export function joinUrl(token: string): string {
  return `${appBaseUrl()}/join/${token}`;
}

export function inviteIsUsable(invite: { status: string; expiresAt: Date }): boolean {
  return invite.status === "active" && invite.expiresAt.getTime() > Date.now();
}

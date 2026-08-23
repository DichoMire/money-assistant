import { randomBytes } from "node:crypto";

export const INVITE_TTL_DAYS = 7;

export function newInviteToken(): string {
  return randomBytes(24).toString("base64url");
}

export function inviteExpiry(from = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 86_400_000);
}

/** Absolute base URL of the deployed app, for links placed in emails. */
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

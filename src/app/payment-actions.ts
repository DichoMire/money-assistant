"use server";

import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentProfiles } from "@/db/schema";
import { fail, requireUser } from "@/lib/action-helpers";
import { loadCircle } from "@/lib/group-data";
import { getT } from "@/lib/i18n-server";
import {
  isValidIban,
  normalizeIban,
  normalizePhone,
  normalizeRevolutTag,
} from "@/lib/payment-details";
import type { ActionResult, PaymentProfileDto } from "@/lib/types";

/**
 * Payment-profile actions (RFC 03). Visibility rule: a profile is readable
 * only by users who share at least one group with its owner — the same trust
 * boundary as the Circle feature, enforced HERE, not client-side.
 */

function toDto(row: typeof paymentProfiles.$inferSelect): PaymentProfileDto {
  return {
    iban: row.iban,
    accountName: row.accountName,
    blinkPhone: row.blinkPhone,
    revolutTag: row.revolutTag,
    updatedAt: row.updatedAt.toISOString().slice(0, 10),
  };
}

export async function getMyPaymentProfile(): Promise<PaymentProfileDto | null> {
  const user = await requireUser();
  const db = await getDb();
  const rows = await db
    .select()
    .from(paymentProfiles)
    .where(eq(paymentProfiles.userId, user.id));
  return rows[0] ? toDto(rows[0]) : null;
}

export async function savePaymentProfile(input: {
  iban: string;
  accountName: string;
  blinkPhone: string;
  revolutTag: string;
}): Promise<ActionResult> {
  try {
    const t = await getT();
    const user = await requireUser();

    const iban = input.iban.trim() ? normalizeIban(input.iban) : null;
    if (iban && !isValidIban(iban)) {
      return { ok: false, error: t("payment.invalidIban") };
    }
    const accountName = input.accountName.trim().slice(0, 70) || null;
    if (iban && !accountName) {
      // Verification of Payee: an IBAN without the account holder's name
      // triggers bank-side warnings — require them together.
      return { ok: false, error: t("payment.nameRequiredWithIban") };
    }
    let blinkPhone: string | null = null;
    if (input.blinkPhone.trim()) {
      blinkPhone = normalizePhone(input.blinkPhone);
      if (!blinkPhone) return { ok: false, error: t("payment.invalidPhone") };
    }
    let revolutTag: string | null = null;
    if (input.revolutTag.trim()) {
      revolutTag = normalizeRevolutTag(input.revolutTag);
      if (!revolutTag) return { ok: false, error: t("payment.invalidRevolutTag") };
    }

    const db = await getDb();
    await db
      .insert(paymentProfiles)
      .values({ userId: user.id, iban, accountName, blinkPhone, revolutTag })
      .onConflictDoUpdate({
        target: paymentProfiles.userId,
        set: { iban, accountName, blinkPhone, revolutTag, updatedAt: new Date() },
      });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A co-member's payment details — or null when none / not visible to us. */
export async function getPaymentProfileFor(
  targetUserId: string
): Promise<PaymentProfileDto | null> {
  const user = await requireUser();
  if (targetUserId === user.id) return getMyPaymentProfile();
  // Server-enforced trust boundary: only people you already share a group with.
  const circle = await loadCircle(user.id);
  if (!circle.some((c) => c.userId === targetUserId)) return null;
  const db = await getDb();
  const rows = await db
    .select()
    .from(paymentProfiles)
    .where(eq(paymentProfiles.userId, targetUserId));
  return rows[0] ? toDto(rows[0]) : null;
}

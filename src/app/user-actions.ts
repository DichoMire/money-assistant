"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { users } from "@/db/schema";
import { requireUser } from "@/lib/action-helpers";

/** Account preference: show the informational "≈ лв." next to EUR amounts. */
export async function setShowBgnEquivalent(value: boolean): Promise<void> {
  const user = await requireUser();
  const db = await getDb();
  await db
    .update(users)
    .set({ showBgnEquivalent: value === true })
    .where(eq(users.id, user.id));
  revalidatePath("/", "layout");
}

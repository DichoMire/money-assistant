import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { getDb } from "@/db";
import { receiptScanImages, receiptScans } from "@/db/schema";
import { getMembership } from "@/lib/group-data";

export const dynamic = "force-dynamic";

/**
 * Serves the stored receipt photo to group members. A dedicated route keeps
 * the ~300KB blob out of every RSC payload of the review page.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ scanId: string }> }
) {
  const { scanId } = await params;
  const session = await auth();
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 });

  const db = await getDb();
  const scanRows = await db
    .select({ groupId: receiptScans.groupId })
    .from(receiptScans)
    .where(eq(receiptScans.id, scanId));
  const scan = scanRows[0];
  if (!scan) return new Response("Not found", { status: 404 });
  const membership = await getMembership(db, scan.groupId, session.user.id);
  if (!membership) return new Response("Not found", { status: 404 });

  const imageRows = await db
    .select()
    .from(receiptScanImages)
    .where(eq(receiptScanImages.scanId, scanId));
  const image = imageRows[0];
  if (!image) return new Response("Not found", { status: 404 });

  return new Response(Buffer.from(image.data), {
    headers: {
      "Content-Type": image.contentType,
      "Content-Length": String(image.byteSize),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

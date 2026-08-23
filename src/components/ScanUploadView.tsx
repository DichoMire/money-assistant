"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteScan, parseReceipt } from "@/app/receipt-actions";
import { formatDate } from "@/lib/format";
import { formatCents } from "@/lib/money";
import type { GroupDto, ScanSummaryDto } from "@/lib/types";

// Long grocery receipts need vertical resolution — a 45-line receipt squeezed
// to 1600px makes the text unreadable for the model. Receipt-shaped images
// (tall aspect) keep more height than ordinary photos.
const MAX_EDGE = 2000;
const MAX_EDGE_TALL = 2800;
const TALL_ASPECT = 1.8;
const JPEG_QUALITY = 0.8;
const RETRY_QUALITY = 0.6;
const RETRY_THRESHOLD_BYTES = 2_500_000;

async function decodeImage(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    // EXIF-corrected decode; some formats (e.g. HEIC) throw and hit the fallback.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** Downscale (never upscale) and re-encode as JPEG. */
async function downscaleToJpeg(file: File): Promise<Blob> {
  const source = await decodeImage(file);
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!width || !height) throw new Error("Couldn't read this image.");
  const aspect = Math.max(width, height) / Math.min(width, height);
  const maxEdge = aspect >= TALL_ASPECT ? MAX_EDGE_TALL : MAX_EDGE;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process this image.");
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  let blob = await toBlob(canvas, JPEG_QUALITY);
  if (blob && blob.size > RETRY_THRESHOLD_BYTES) blob = await toBlob(canvas, RETRY_QUALITY);
  if (!blob) throw new Error("Couldn't process this image.");
  return blob;
}

export function ScanUploadView({ group, scans }: { group: GroupDto; scans: ScanSummaryDto[] }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (busy || !file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("Choose an image file (a photo of the receipt).");
      return;
    }
    setBusy("Preparing photo…");
    try {
      const jpeg = await downscaleToJpeg(file);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(jpeg);
      });
      setBusy("Reading receipt… this can take up to a minute");
      const formData = new FormData();
      formData.append("image", new File([jpeg], "receipt.jpg", { type: "image/jpeg" }));
      const result = await parseReceipt(group.id, formData);
      if (result.ok) {
        router.push(`/groups/${group.id}/scan/${result.scanId}`);
        return; // keep the busy state up while navigating
      }
      setError(result.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this image — try a JPEG or PNG photo.");
    }
    setBusy(null);
  };

  const removeScan = async (scan: ScanSummaryDto) => {
    if (!window.confirm("Delete this scan? The expense created from it (if any) is kept.")) return;
    setDeletingId(scan.id);
    const result = await deleteScan(scan.id);
    setDeletingId(null);
    if (result.ok) router.refresh();
    else window.alert(result.error);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href={`/groups/${group.id}`}
          className="cursor-pointer rounded-md px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label="Back to group"
        >
          ←
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Scan a receipt</h1>
          <p className="text-sm text-gray-500">{group.name}</p>
        </div>
      </div>

      <div
        className={`card cursor-pointer border-2 border-dashed px-6 py-10 text-center transition-colors ${
          dragOver ? "bg-emerald-50" : "border-gray-300"
        } ${busy ? "pointer-events-none" : ""}`}
        style={dragOver ? { borderColor: "var(--brand)" } : undefined}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void handleFile(e.dataTransfer.files[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        {busy ? (
          <div className="space-y-3">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview}
                alt="Receipt preview"
                className="mx-auto max-h-48 rounded-lg border border-gray-200 object-contain"
              />
            )}
            <p className="text-sm font-semibold text-gray-600">{busy}</p>
          </div>
        ) : (
          <>
            <p className="text-4xl" aria-hidden>
              🧾
            </p>
            <p className="mt-2 text-base font-semibold text-gray-700">
              Drop a receipt photo here
            </p>
            <p className="mt-1 text-sm text-gray-500">or click to choose a file</p>
          </>
        )}
      </div>

      {error && (
        <p className="mt-3 text-sm font-medium text-red-600">
          {error}{" "}
          <Link href={`/groups/${group.id}`} className="underline">
            Add the expense manually instead
          </Link>
          .
        </p>
      )}

      {scans.length > 0 && (
        <div className="mt-8">
          <p className="label">Previous scans</p>
          <ul className="card divide-y divide-gray-100">
            {scans.map((scan) => (
              <li key={scan.id} className="flex items-center gap-3 px-4 py-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                  onClick={() => router.push(`/groups/${group.id}/scan/${scan.id}`)}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800">
                      {scan.merchant ?? "Receipt"}
                      {!scan.reconciles && (
                        <span className="ml-1.5 text-amber-500" title="Items don't add up to the total">
                          ⚠
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDate(scan.date)} · {scan.itemCount}{" "}
                      {scan.itemCount === 1 ? "item" : "items"}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      scan.expenseId
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {scan.expenseId ? "Converted" : "Draft"}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-gray-800">
                    {formatCents(scan.totalCents, scan.currency)}
                  </span>
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md px-2 py-0.5 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
                  aria-label="Delete scan"
                  disabled={deletingId === scan.id}
                  onClick={() => void removeScan(scan)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

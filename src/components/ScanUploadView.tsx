"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { deleteScan, parseReceipt } from "@/app/receipt-actions";
import { formatDate } from "@/lib/format";
import { countWord, type TFunc } from "@/lib/i18n";
import { formatCents } from "@/lib/money";
import { RECEIPT_LLM_VENDOR } from "@/lib/receipt-schema";
import type { ScanQuota } from "@/lib/scan-usage";
import type { GroupDto, ScanSummaryDto } from "@/lib/types";
import { useConfirm } from "./ConfirmModal";
import { useLocale, useT } from "./LocaleProvider";

/** localStorage flag: the first-use "photo goes to an AI service" dialog. */
const LLM_NOTICE_SEEN_KEY = "scan-llm-notice-v1";

// Long grocery receipts need vertical resolution — a 45-line receipt squeezed
// to 1600px makes the text unreadable for the model. Receipt-shaped images
// (tall aspect) keep more height than ordinary photos.
const MAX_EDGE = 2000;
const MAX_EDGE_TALL = 2800;
const TALL_ASPECT = 1.8;
const JPEG_QUALITY = 0.8;
const RETRY_QUALITY = 0.6;
const RETRY_THRESHOLD_BYTES = 2_500_000;
// Retry-at-higher-res (RFC 04 §3.7): re-encode the still-held original at
// higher fidelity; new bytes hash differently so dedupe won't short-circuit.
const HI_RES_EDGE = 3600;
const HI_RES_QUALITY = 0.85;

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

/** Downscale (never upscale) and re-encode as JPEG. `hiRes` is the one-shot
 *  retry mode: bigger edge + higher quality for hard-to-read receipts. */
async function downscaleToJpeg(file: File, t: TFunc, hiRes = false): Promise<Blob> {
  const source = await decodeImage(file);
  const width = "naturalWidth" in source ? source.naturalWidth : source.width;
  const height = "naturalHeight" in source ? source.naturalHeight : source.height;
  if (!width || !height) throw new Error(t("scan.cantRead"));
  const aspect = Math.max(width, height) / Math.min(width, height);
  const maxEdge = hiRes ? HI_RES_EDGE : aspect >= TALL_ASPECT ? MAX_EDGE_TALL : MAX_EDGE;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("scan.cantProcess"));
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  if ("close" in source) source.close();
  let blob = await toBlob(canvas, hiRes ? HI_RES_QUALITY : JPEG_QUALITY);
  if (blob && blob.size > RETRY_THRESHOLD_BYTES) blob = await toBlob(canvas, RETRY_QUALITY);
  if (!blob) throw new Error(t("scan.cantProcess"));
  return blob;
}

export function ScanUploadView({
  group,
  scans,
  quota,
}: {
  group: GroupDto;
  scans: ScanSummaryDto[];
  quota: ScanQuota | null;
}) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const money = (cents: number, currency: string) => formatCents(cents, currency, locale);
  const { ask, confirmElement } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);
  const [quotaHit, setQuotaHit] = useState(false);
  const [canRetryHiRes, setCanRetryHiRes] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (busy || !file) return;
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError(t("scan.chooseImage"));
      return;
    }
    // First-use transparency dialog (Art. 13): the photo goes to a third-party
    // AI service. Device-scoped memory is fine — the permanent caption under
    // the upload card is the layer that satisfies the transparency duty.
    let seen = false;
    try {
      seen = localStorage.getItem(LLM_NOTICE_SEEN_KEY) === "1";
    } catch {
      seen = true; // storage unavailable — don't trap the user in a loop
    }
    if (!seen) {
      ask(t("scan.llmFirstUse", { vendor: RECEIPT_LLM_VENDOR }), () => {
        try {
          localStorage.setItem(LLM_NOTICE_SEEN_KEY, "1");
        } catch {}
        void processFile(file);
      });
      return;
    }
    await processFile(file);
  };

  const processFile = async (file: File, hiRes = false) => {
    setBusy(t("scan.preparing"));
    setQuotaHit(false);
    setCanRetryHiRes(false);
    lastFileRef.current = file;
    try {
      const jpeg = await downscaleToJpeg(file, t, hiRes);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(jpeg);
      });
      setBusy(t("scan.reading"));
      const formData = new FormData();
      formData.append("image", new File([jpeg], "receipt.jpg", { type: "image/jpeg" }));
      const result = await parseReceipt(group.id, formData);
      if (result.ok) {
        router.push(`/groups/${group.id}/scan/${result.scanId}`);
        return; // keep the busy state up while navigating
      }
      setError(result.error);
      if (result.quotaExceeded) setQuotaHit(true);
      // One-shot retry offer at higher fidelity (only while the original
      // File is still in hand, and only if we haven't already tried).
      else if (!hiRes) setCanRetryHiRes(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("scan.cantReadImage"));
    }
    setBusy(null);
  };

  const removeScan = (scan: ScanSummaryDto) => {
    ask(
      t("scan.deleteConfirm", {
        name: scan.merchant ?? t("scan.receiptFallback"),
        amount: money(scan.totalCents, scan.currency),
      }),
      async () => {
        setDeletingId(scan.id);
        const result = await deleteScan(scan.id);
        setDeletingId(null);
        if (result.ok) router.refresh();
        else window.alert(result.error);
      }
    );
  };

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-3">
        <Link
          href={`/groups/${group.id}`}
          className="cursor-pointer rounded-md px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          aria-label={t("scan.backToGroup")}
        >
          ←
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{t("scan.title")}</h1>
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
                alt={t("scan.previewAlt")}
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
            <p className="mt-2 text-base font-semibold text-gray-700">{t("scan.dropHere")}</p>
            <p className="mt-1 text-sm text-gray-500">{t("scan.clickToChoose")}</p>
          </>
        )}
      </div>

      {/* Permanent transparency caption (Art. 13): where the photo goes. */}
      <p className="mt-2 text-center text-xs text-gray-400">
        {t("scan.llmNotice", { vendor: RECEIPT_LLM_VENDOR })}{" "}
        <Link href="/privacy" className="underline hover:text-gray-600">
          {t("account.privacyPolicy")}
        </Link>
      </p>

      {/* Proactive quota counter — amber at one remaining (no surprise
          exhaustion); enforcement itself lives server-side. */}
      {quota && quota.enforced && (
        <p
          className={`mt-1 text-center text-xs ${
            quota.limit - quota.used <= 1 ? "font-semibold text-amber-600" : "text-gray-400"
          }`}
        >
          {t("quota.counter", { used: quota.used, limit: quota.limit })}
        </p>
      )}

      {quotaHit ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <p className="font-semibold">{error}</p>
          <p className="mt-1 text-xs">
            {t("quota.resetsMonthly")}{" "}
            <Link href={`/groups/${group.id}`} className="underline">
              {t("scan.addManually")}
            </Link>
            .
          </p>
        </div>
      ) : (
        error && (
          <p className="mt-3 text-sm font-medium text-red-600">
            {error}{" "}
            {canRetryHiRes && lastFileRef.current && (
              <>
                <button
                  type="button"
                  className="cursor-pointer font-semibold underline"
                  onClick={() => void processFile(lastFileRef.current!, true)}
                >
                  {t("scan.retryHiRes")}
                </button>
                {" · "}
              </>
            )}
            <Link href={`/groups/${group.id}`} className="underline">
              {t("scan.addManually")}
            </Link>
            .
          </p>
        )
      )}

      {scans.length > 0 && (
        <div className="mt-8">
          <p className="label">{t("scan.previousScans")}</p>
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
                      {scan.merchant ?? t("scan.receiptFallback")}
                      {!scan.reconciles && (
                        <span className="ml-1.5 text-amber-500" title={t("scan.mismatchTooltip")}>
                          ⚠
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {formatDate(scan.date, locale)} · {scan.itemCount}{" "}
                      {countWord(t, scan.itemCount, "count.item", "count.items")}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
                      scan.expenseId
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {scan.expenseId ? t("scan.converted") : t("scan.draft")}
                  </span>
                  <span className="shrink-0 text-sm font-semibold text-gray-800">
                    {money(scan.totalCents, scan.currency)}
                  </span>
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-md px-2 py-0.5 text-lg leading-none text-gray-300 hover:bg-red-50 hover:text-red-500"
                  aria-label={t("scan.deleteAria")}
                  disabled={deletingId === scan.id}
                  onClick={() => removeScan(scan)}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {confirmElement}
    </div>
  );
}

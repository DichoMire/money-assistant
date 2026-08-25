/**
 * The one brand tile, shared by the header, login and join cards so a future
 * rebrand happens in a single place. If the glyph or color ever changes,
 * regenerate the PWA icon set (public/icon-*.png, apple-touch-icon.png) in
 * the same change — the installed icon and the in-app tile must stay
 * identical (RFC 05 §3.1).
 */
export const BRAND_GLYPH = "€";

export function BrandMark({ size = "lg" }: { size?: "sm" | "lg" }) {
  return (
    <span
      className={
        size === "lg"
          ? "mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-3xl font-bold text-white"
          : "flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white"
      }
      style={{ background: "var(--brand)" }}
      aria-hidden
    >
      {BRAND_GLYPH}
    </span>
  );
}

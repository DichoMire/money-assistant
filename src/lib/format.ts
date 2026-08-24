import type { Locale } from "./i18n";

const MONTHS: Record<Locale, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  bg: ["яну", "фев", "мар", "апр", "май", "юни", "юли", "авг", "сеп", "окт", "ное", "дек"],
};

/** en: "2026-08-23" -> "Aug 23" (or "Aug 23, 2025"); bg: "23 авг" (or "23 авг 2025"). */
export function formatDate(dateStr: string, locale: Locale = "en"): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const month = MONTHS[locale][(m ?? 1) - 1];
  const label = locale === "bg" ? `${d} ${month}` : `${month} ${d}`;
  if (y === new Date().getFullYear()) return label;
  return locale === "bg" ? `${label} ${y}` : `${label}, ${y}`;
}

const AVATAR_COLORS = [
  "#0ea5e9", "#8b5cf6", "#f59e0b", "#ef4444", "#10b981",
  "#ec4899", "#6366f1", "#14b8a6", "#f97316", "#84cc16",
];

/** Stable color for a participant, derived from their id. */
export function avatarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

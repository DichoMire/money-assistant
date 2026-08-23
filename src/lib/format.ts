const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-08-23" -> "Aug 23" (or "Aug 23, 2025" for other years). */
export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const label = `${MONTHS[(m ?? 1) - 1]} ${d}`;
  return y === new Date().getFullYear() ? label : `${label}, ${y}`;
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

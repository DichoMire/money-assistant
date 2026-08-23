import { avatarColor } from "@/lib/format";

export function Avatar({ id, name, size = 32 }: { id: string; name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white select-none"
      style={{ width: size, height: size, background: avatarColor(id), fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}

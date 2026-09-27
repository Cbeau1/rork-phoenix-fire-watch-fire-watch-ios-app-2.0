import { format, formatDistanceToNowStrict, isToday, isYesterday } from "date-fns";

/** "7 minutes ago" style relative time. */
export const timeAgo = (iso: string): string => `${formatDistanceToNowStrict(new Date(iso))} ago`;

/** "2:33 PM" */
export const timeOfDay = (iso: string): string => format(new Date(iso), "h:mm a");

/** "Today", "Yesterday" or "Thu, Sep 25, 2026" */
export const dayLabel = (iso: string): string => {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d, yyyy");
};

/** "Sep 25, 2026 · 2:33 PM" */
export const fullDateTime = (iso: string): string => format(new Date(iso), "MMM d, yyyy · h:mm a");

/** Stable yyyy-MM-dd key in local time for grouping patrols by 24-hour activity period. */
export const dayKey = (iso: string): string => format(new Date(iso), "yyyy-MM-dd");

/** Value for <input type="datetime-local"> in local time. */
export const toLocalInputValue = (date: Date): string => format(date, "yyyy-MM-dd'T'HH:mm");

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "PF";

export const uid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

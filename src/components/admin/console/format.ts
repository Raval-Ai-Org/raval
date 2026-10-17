// Small display helpers for the admin console. Pure.

const DATE = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});
const DATE_TIME = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE.format(date);
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : DATE_TIME.format(date);
}

/** "3 min ago", "2 days ago". */
export function ago(value: string | null | undefined, now = Date.now()): string {
  if (!value) return "never";
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "—";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 60) return `${days} day${days === 1 ? "" : "s"} ago`;
  return fmtDate(value);
}

export function fmtNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** "workspace.suspended" → "Workspace suspended". */
export function actionLabel(action: string): string {
  const text = action.replace(/[._]/g, " ").trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "$12.40", "$0.0031": small amounts keep their precision. */
export function fmtUsd(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const digits = value !== 0 && Math.abs(value) < 1 ? 4 : 2;
  return `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits })}`;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

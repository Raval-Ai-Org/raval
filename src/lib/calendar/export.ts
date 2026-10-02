// Content Calendar exports — pure builders for the files a person can take
// away: a spreadsheet (CSV), a calendar file (.ics) that Google Calendar,
// Outlook and Apple Calendar all import, plain text, and a printable page.
// Nothing here touches the DOM; the component turns the strings into downloads.

import {
  channelInfo,
  groupByDate,
  parseYMD,
  sortEntries,
  STATUS_LABEL,
  type CalendarEntry,
} from "./model";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function dayName(date: string): string {
  return WEEKDAYS[parseYMD(date).getDay()];
}

/** "Monday, 5 October 2026" — fixed wording so files read the same everywhere. */
export function longDate(date: string): string {
  const d = parseYMD(date);
  return `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Only real web links go into a file; an unsaved in-browser image is skipped. */
function imageLink(entry: CalendarEntry): string {
  return entry.images.find((src) => /^https?:\/\//i.test(src)) ?? "";
}

/* ───────────────────────────── CSV ───────────────────────────── */

export const CSV_COLUMNS = [
  "Date",
  "Day",
  "Time",
  "Channel",
  "Type",
  "Topic",
  "Title",
  "Caption",
  "Hashtags",
  "Status",
  "Image",
] as const;

/**
 * One CSV cell. Always quoted. A cell that a spreadsheet would run as a formula
 * (`=`, `+`, `-`, `@`, tab, carriage return first) gets a leading apostrophe, so
 * a caption can never execute when the file is opened.
 */
export function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function calendarCsv(entries: CalendarEntry[]): string {
  const rows = sortEntries(entries).map((e) => [
    e.date,
    dayName(e.date),
    e.time,
    channelInfo(e.channel).label,
    e.format,
    e.topic ?? "",
    e.title,
    e.caption ?? "",
    e.hashtags.join(" "),
    STATUS_LABEL[e.status],
    imageLink(e),
  ]);
  return [CSV_COLUMNS as readonly string[], ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}

/* ───────────────────────────── iCalendar ───────────────────────────── */

function icsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

/** RFC 5545 line folding: no line longer than 75 bytes, continuation lines start with a space. */
export function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const out: string[] = [];
  let current = "";
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    // Continuation lines spend one byte on their leading space.
    const limit = out.length === 0 ? 75 : 74;
    if (bytes + size > limit) {
      out.push(current);
      current = "";
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

function icsLocal(date: string, time: string, addMinutes = 0): string {
  const [h, m] = time.split(":").map(Number);
  const d = parseYMD(date);
  d.setHours(h || 0, (m || 0) + addMinutes, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
}

function icsStamp(now: Date): string {
  return now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

/**
 * A calendar file with one 30-minute event per post. Times are "floating"
 * (no time zone), so each post shows at the same clock time it has in Mellox.
 */
export function calendarIcs(entries: CalendarEntry[], opts: { name: string; now?: Date }): string {
  const stamp = icsStamp(opts.now ?? new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mellox AI//Content Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText(opts.name)}`,
  ];
  for (const e of sortEntries(entries)) {
    const channel = channelInfo(e.channel).label;
    const description = [
      e.caption ?? "",
      e.hashtags.join(" "),
      `Status: ${STATUS_LABEL[e.status]}`,
      e.topic ? `Topic: ${e.topic}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.id}@calendar.mellox.ai`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsLocal(e.date, e.time)}`,
      `DTEND:${icsLocal(e.date, e.time, 30)}`,
      `SUMMARY:${icsText(`${channel}: ${e.title}`)}`,
      `DESCRIPTION:${icsText(description)}`,
      `CATEGORIES:${icsText(channel)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

/* ───────────────────────────── plain text ───────────────────────────── */

export function calendarText(entries: CalendarEntry[]): string {
  const blocks: string[] = [];
  for (const [date, list] of groupByDate(entries)) {
    blocks.push(
      [
        longDate(date),
        ...list.map((e) =>
          [
            `${e.time} · ${channelInfo(e.channel).label} · ${e.format} · ${STATUS_LABEL[e.status]}`,
            e.title,
            e.caption ?? "",
            e.hashtags.join(" "),
          ]
            .filter(Boolean)
            .join("\n"),
        ),
      ].join("\n\n"),
    );
  }
  return blocks.join("\n\n────────\n\n");
}

/* ───────────────────────────── printable page ───────────────────────────── */

function html(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A self-contained page for the browser's print dialog ("Save as PDF"). */
export function calendarPrintHtml(
  entries: CalendarEntry[],
  opts: { title: string; subtitle?: string },
): string {
  const days = [...groupByDate(entries)]
    .map(
      ([date, list]) => `<section>
<h2>${html(longDate(date))}</h2>
${list
  .map(
    (e) => `<article>
<div class="meta"><b>${html(e.time)}</b> · ${html(channelInfo(e.channel).label)} · ${html(e.format)}${
      e.topic ? ` · ${html(e.topic)}` : ""
    } <span class="status">${html(STATUS_LABEL[e.status])}</span></div>
<h3>${html(e.title)}</h3>
${e.caption ? `<p>${html(e.caption).replace(/\n/g, "<br>")}</p>` : ""}
${e.hashtags.length ? `<p class="tags">${html(e.hashtags.join(" "))}</p>` : ""}
</article>`,
  )
  .join("\n")}
</section>`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${html(opts.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 12px/1.5 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 24px; }
  h1 { font-size: 20px; margin: 0; }
  .sub { color: #666; margin: 2px 0 18px; }
  h2 { font-size: 13px; margin: 18px 0 6px; padding-bottom: 4px; border-bottom: 1px solid #ddd; }
  article { padding: 8px 0; border-bottom: 1px solid #eee; break-inside: avoid; }
  h3 { font-size: 13px; margin: 2px 0; }
  p { margin: 4px 0; white-space: normal; }
  .meta { color: #555; font-size: 11px; }
  .status { float: right; border: 1px solid #ccc; border-radius: 999px; padding: 0 8px; font-size: 10px; }
  .tags { color: #555; }
  @page { margin: 14mm; }
</style>
</head>
<body>
<h1>${html(opts.title)}</h1>
<div class="sub">${html(opts.subtitle ?? "")}</div>
${days || "<p>No posts.</p>"}
</body>
</html>`;
}

/** "acme-content-calendar-2026-10.csv" — safe on every file system. */
export function exportFileName(brand: string, range: string, ext: string): string {
  const slug = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  return [slug(brand), "content-calendar", slug(range)].filter(Boolean).join("-") + `.${ext}`;
}

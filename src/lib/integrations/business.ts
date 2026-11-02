// Business apps through Composio (ADR-0042, Phase 4). Pure and browser-safe:
// the exact tool arguments for each workflow and the readers for their
// results. Argument names follow the live tool schemas (checked 2026-11-03).
//
//   HubSpot       how many contacts were added since the goal started
//                 (read only; the leads goal shows it as measured)
//   Mailchimp     a post or campaign email saved as a draft campaign
//                 (never sent or scheduled from Mellox)
//   Google Sheets the content calendar exported to a new sheet

// ── HubSpot: new contacts since a date ────────────────────────────────────

export function hubspotNewContactsArgs(since: Date): Record<string, unknown> {
  return {
    filterGroups: [
      {
        filters: [{ propertyName: "createdate", operator: "GTE", value: String(since.getTime()) }],
      },
    ],
    properties: ["createdate"],
    limit: 1,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** HubSpot's `total`, at either level of Composio's wrapping; null when absent. */
export function readTotal(data: unknown): number | null {
  for (const level of [record(data), record(record(data)?.data)]) {
    const total = level?.total;
    if (typeof total === "number" && Number.isFinite(total) && total >= 0) return total;
  }
  return null;
}

/** A stored lead count on integration_accounts.metadata.leads. */
export type LeadCount = { value: number; since: string; measuredAt: string };

export function readLeadCount(metadata: unknown): LeadCount | null {
  const leads = record(record(metadata)?.leads);
  if (!leads) return null;
  const { value, since, measuredAt } = leads;
  return typeof value === "number" && typeof since === "string" && typeof measuredAt === "string"
    ? { value, since, measuredAt }
    : null;
}

/** A count is refreshed twice a day at most. */
export const LEADS_REFRESH_MS = 12 * 3600_000;

export function leadCountDue(current: LeadCount | null, since: string, now: number): boolean {
  if (!current || current.since !== since) return true;
  return now - Date.parse(current.measuredAt) >= LEADS_REFRESH_MS;
}

// ── Mailchimp: a draft campaign ───────────────────────────────────────────

export type MailchimpList = { id: string; name: string };

export function readMailchimpLists(data: unknown): MailchimpList[] {
  const lists = record(data)?.lists ?? record(record(data)?.data)?.lists;
  if (!Array.isArray(lists)) return [];
  return lists
    .map(record)
    .filter((l): l is Record<string, unknown> => !!l && typeof l.id === "string")
    .map((l) => ({
      id: l.id as string,
      name: typeof l.name === "string" ? l.name : (l.id as string),
    }));
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Plain words to simple email HTML: paragraphs, line breaks, https links. */
export function emailHtml(body: string, imageUrl?: string | null): string {
  const paragraphs = body
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p>${escapeHtml(p)
          .replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
          .replace(/\n/g, "<br>")}</p>`,
    );
  const image =
    imageUrl && /^https:\/\//.test(imageUrl)
      ? `<p><img src="${escapeHtml(imageUrl)}" alt="" style="max-width:100%;height:auto"></p>`
      : "";
  return `<!doctype html><html><body>${image}${paragraphs.join("")}</body></html>`;
}

/** First line, cut to Mailchimp's 150-character subject line. */
export function subjectFrom(title: string | null | undefined, body: string): string {
  const raw = (title?.trim() || body.split("\n").find((l) => l.trim()) || "New from us").trim();
  return raw.length > 150 ? `${raw.slice(0, 147).trimEnd()}...` : raw;
}

export function mailchimpCampaignArgs(a: {
  listId: string;
  subject: string;
  fromName: string;
  title: string;
}): Record<string, unknown> {
  return {
    type: "regular",
    recipients__list__id: a.listId,
    settings__subject__line: a.subject,
    settings__title: a.title.slice(0, 100),
    settings__from__name: a.fromName.slice(0, 100),
  };
}

export function mailchimpContentArgs(
  campaignId: string,
  html: string,
  plainText: string,
): Record<string, unknown> {
  return { campaign_id: campaignId, html, plain_text: plainText };
}

/** Where the person finds the draft. */
export function mailchimpDraftUrl(webId: unknown): string | null {
  return typeof webId === "number" || (typeof webId === "string" && /^\d+$/.test(webId))
    ? `https://admin.mailchimp.com/campaigns/edit?id=${webId}`
    : null;
}

// ── Google Sheets: the calendar ───────────────────────────────────────────

export type CalendarRow = {
  date: string | null;
  channel: string | null;
  status: string;
  title: string | null;
  text: string;
  link: string | null;
};

export const CALENDAR_HEADER = ["Date", "Channel", "Status", "Title", "Text", "Link"];

/** Sheets refuses cells over 50,000 characters. */
const CELL_MAX = 49_000;

/** A leading = + - @ would make Sheets read a cell as a formula. */
function cell(value: string | null): string {
  const text = (value ?? "").slice(0, CELL_MAX);
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

export function calendarValues(rows: CalendarRow[]): string[][] {
  const sorted = [...rows].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  return [
    CALENDAR_HEADER,
    ...sorted.map((r) => [
      cell(r.date ? r.date.slice(0, 16).replace("T", " ") : ""),
      cell(r.channel),
      cell(r.status),
      cell(r.title),
      cell(r.text),
      cell(r.link),
    ]),
  ];
}

export function sheetValuesArgs(
  spreadsheetId: string,
  values: string[][],
): Record<string, unknown> {
  // "A1" with no sheet name is the first sheet, whatever the account's language calls it.
  return {
    spreadsheet_id: spreadsheetId,
    valueInputOption: "RAW",
    data: [{ range: "A1", values }],
  };
}

/** The new sheet's id and link from the create tool's result. */
export function readSpreadsheet(data: unknown): { id: string; url: string } | null {
  for (const level of [record(data), record(record(data)?.data)]) {
    const id = level?.spreadsheetId ?? level?.spreadsheet_id ?? level?.id;
    if (typeof id === "string" && id) {
      const url = level?.spreadsheetUrl ?? level?.spreadsheet_url;
      return {
        id,
        url:
          typeof url === "string" && url.startsWith("https://")
            ? url
            : `https://docs.google.com/spreadsheets/d/${id}/edit`,
      };
    }
  }
  return null;
}

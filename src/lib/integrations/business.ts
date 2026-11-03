// Business apps through Composio (ADR-0042, Phase 4). Pure and browser-safe:
// the exact tool arguments for each workflow and the readers for their
// results. Argument names follow the live tool schemas (checked 2026-11-03).
//
//   HubSpot       how many contacts were added since the goal started
//                 (read only; the leads goal shows it as measured)
//   Mailchimp     a post or campaign email saved as a draft campaign
//                 (never sent or scheduled from Mellox)
//   Google Sheets the content calendar exported to a new sheet
//   Google Drive  a finished post's pictures, video and words saved into a
//                 "Mellox" folder (new files only)
//   Gmail         a post or article saved as a Gmail draft (never sent)
//   Google Ads    a Studio ad made into a paused Search campaign: budget,
//                 campaign, ad group and responsive search ad, all paused

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

// ── Google Drive: a finished post into a Mellox folder ────────────────────

export const DRIVE_FOLDER = "Mellox";

/** A Drive-safe, readable file name: the post's title, then the part number. */
export function driveFileName(
  title: string | null | undefined,
  n: number,
  total: number,
  path: string,
): string {
  const ext = /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase() ?? "jpg";
  const base =
    (title ?? "")
      .replace(/[\\/:*?"<>|#\n\r\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "Mellox post";
  return total > 1 ? `${base} (${n + 1} of ${total}).${ext}` : `${base}.${ext}`;
}

/** The first folder id in a find/create result; null when none. */
export function readDriveId(data: unknown): string | null {
  const levels = [record(data), record(record(data)?.data)];
  for (const level of levels) {
    if (typeof level?.id === "string" && level.id) return level.id;
    for (const key of ["folders", "files", "items"]) {
      const list = level?.[key];
      if (Array.isArray(list)) {
        const first = record(list[0]);
        if (typeof first?.id === "string" && first.id) return first.id;
      }
    }
  }
  return null;
}

export function driveFolderUrl(folderId: string): string {
  return `https://drive.google.com/drive/folders/${encodeURIComponent(folderId)}`;
}

// ── Gmail: a draft ────────────────────────────────────────────────────────

export function gmailDraftArgs(subject: string, html: string): Record<string, unknown> {
  // No recipient: the person picks who it goes to in Gmail.
  return { user_id: "me", subject, body: html, is_html: true };
}

export function readGmailDraftId(data: unknown): string | null {
  for (const level of [record(data), record(record(data)?.data)]) {
    const id = level?.id ?? record(level?.draft)?.id;
    if (typeof id === "string" && id) return id;
  }
  return null;
}

// ── Google Ads: a paused Search campaign from a Studio ad ─────────────────
//
// Everything is created PAUSED and never switched on from Mellox: nothing
// runs or spends until the person turns it on in Google Ads, after adding the
// keywords they want. The words come from the ad as the person approved it.

export type AdCopy = { headline: string; primaryText: string; description: string };

const RSA_HEADLINE_MAX = 30;
const RSA_DESCRIPTION_MAX = 90;

function fit(text: string, max: number): string | null {
  const clean = text
    .replace(/\s+/g, " ")
    .replace(/[!]{2,}/g, "!")
    .trim();
  if (!clean) return null;
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[,;:\-–]+$/, "").trim();
}

/** Responsive search ad text: 3-15 headlines, 2-4 descriptions, all distinct. */
export function rsaText(
  ads: AdCopy[],
  brand: string,
): { headlines: string[]; descriptions: string[] } | null {
  const uniq = (list: (string | null)[]) => [
    ...new Map(
      list.filter((x): x is string => !!x).map((x) => [x.toLowerCase(), x] as const),
    ).values(),
  ];
  const headlines = uniq([
    ...ads.map((a) => fit(a.headline, RSA_HEADLINE_MAX)),
    ...ads.flatMap((a) =>
      a.primaryText.split(/(?<=[.!?])\s+/).map((s) => fit(s, RSA_HEADLINE_MAX)),
    ),
    fit(brand, RSA_HEADLINE_MAX),
  ]).slice(0, 15);
  const descriptions = uniq([
    ...ads.map((a) => fit(a.description, RSA_DESCRIPTION_MAX)),
    ...ads.map((a) => fit(a.primaryText, RSA_DESCRIPTION_MAX)),
  ]).slice(0, 4);
  if (headlines.length < 3 || descriptions.length < 2) return null;
  return { headlines, descriptions };
}

/** The customer id from `customers/1234567890`; null when it isn't one. */
export function readCustomerIds(data: unknown): string[] {
  const text = JSON.stringify(data ?? null);
  return [...new Set([...text.matchAll(/customers\/(\d{6,12})(?!\/)/g)].map((m) => m[1]))];
}

/** The first resource name of one kind in a mutate result (e.g. campaignBudgets). */
export function readResourceName(data: unknown, kind: string): string | null {
  const text = JSON.stringify(data ?? null);
  const match = new RegExp(`customers/\\d+/${kind}/\\d+`).exec(text);
  return match ? match[0] : null;
}

export function googleAdsBudgetArgs(
  customerId: string,
  name: string,
  dailyMicros: number,
): Record<string, unknown> {
  return {
    customer_id: customerId,
    operations: [
      {
        create: {
          name,
          amount_micros: dailyMicros,
          delivery_method: "STANDARD",
          explicitly_shared: false,
        },
      },
    ],
  };
}

export function googleAdsCampaignArgs(
  customerId: string,
  name: string,
  budget: string,
): Record<string, unknown> {
  return {
    customer_id: customerId,
    operations: [
      {
        operation_type: "create",
        create: {
          name,
          status: "paused",
          advertising_channel_type: "search",
          campaign_budget: budget,
          manual_cpc: {},
          network_settings: {
            target_google_search: true,
            target_search_network: false,
            target_content_network: false,
          },
          contains_eu_political_advertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
        },
      },
    ],
  };
}

export function googleAdsAdGroupArgs(
  customerId: string,
  name: string,
  campaign: string,
): Record<string, unknown> {
  return {
    customer_id: customerId,
    operations: [{ create: { name, campaign, status: "PAUSED", type: "SEARCH_STANDARD" } }],
  };
}

export function googleAdsAdArgs(
  customerId: string,
  adGroup: string,
  text: { headlines: string[]; descriptions: string[] },
  finalUrl: string,
): Record<string, unknown> {
  return {
    customer_id: customerId,
    operations: [
      {
        create: {
          ad_group: adGroup,
          status: "PAUSED",
          ad: {
            final_urls: [finalUrl],
            responsive_search_ad: {
              headlines: text.headlines.map((t) => ({ text: t })),
              descriptions: text.descriptions.map((t) => ({ text: t })),
            },
          },
        },
      },
    ],
  };
}

export function googleAdsCampaignUrl(customerId: string, campaign: string): string {
  const id = /campaigns\/(\d+)/.exec(campaign)?.[1];
  return id
    ? `https://ads.google.com/aw/adgroups?campaignId=${id}&__c=${customerId}`
    : "https://ads.google.com/aw/campaigns";
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

import { describe, expect, it } from "vitest";
import {
  calendarValues,
  emailHtml,
  hubspotNewContactsArgs,
  leadCountDue,
  mailchimpCampaignArgs,
  mailchimpDraftUrl,
  readLeadCount,
  readMailchimpLists,
  readSpreadsheet,
  readTotal,
  sheetValuesArgs,
  subjectFrom,
} from "./business";
import { DESTRUCTIVE_WORDS, integrationApp } from "./catalog";

describe("HubSpot", () => {
  it("asks only for contacts created since the goal started, one row", () => {
    const args = hubspotNewContactsArgs(new Date("2026-10-01T00:00:00Z"));
    expect(args).toEqual({
      filterGroups: [
        { filters: [{ propertyName: "createdate", operator: "GTE", value: "1790812800000" }] },
      ],
      properties: ["createdate"],
      limit: 1,
    });
  });

  it("reads the total at either level and refuses anything else", () => {
    expect(readTotal({ total: 42, results: [] })).toBe(42);
    expect(readTotal({ data: { total: 0 } })).toBe(0);
    expect(readTotal({ results: [] })).toBeNull();
    expect(readTotal({ total: -1 })).toBeNull();
  });

  it("refreshes a count twice a day, or at once when the goal changed", () => {
    const c = { value: 3, since: "2026-10-01", measuredAt: "2026-11-03T00:00:00Z" };
    const t = Date.parse("2026-11-03T06:00:00Z");
    expect(leadCountDue(c, "2026-10-01", t)).toBe(false);
    expect(leadCountDue(c, "2026-10-01", t + 7 * 3600_000)).toBe(true);
    expect(leadCountDue(c, "2026-11-01", t)).toBe(true);
    expect(leadCountDue(null, "2026-10-01", t)).toBe(true);
    expect(readLeadCount({ leads: c })).toEqual(c);
    expect(readLeadCount({ leads: { value: "3" } })).toBeNull();
  });
});

describe("Mailchimp", () => {
  it("makes a regular campaign for one audience, never sent", () => {
    expect(
      mailchimpCampaignArgs({ listId: "l1", subject: "Hi", fromName: "BeanCo", title: "Post" }),
    ).toEqual({
      type: "regular",
      recipients__list__id: "l1",
      settings__subject__line: "Hi",
      settings__title: "Post",
      settings__from__name: "BeanCo",
    });
  });

  it("escapes the words, keeps paragraphs and links", () => {
    const html = emailHtml("Hello <b>you</b>\nline two\n\nSee https://x.co/a", "https://cdn/x.jpg");
    expect(html).toContain("<p>Hello &lt;b&gt;you&lt;/b&gt;<br>line two</p>");
    expect(html).toContain('<a href="https://x.co/a">https://x.co/a</a>');
    expect(html).toContain('<img src="https://cdn/x.jpg"');
    expect(emailHtml("x", "javascript:alert(1)")).not.toContain("<img");
  });

  it("takes the subject from the title or first line, within 150 characters", () => {
    expect(subjectFrom("Title", "body")).toBe("Title");
    expect(subjectFrom(null, "\nFirst line\nmore")).toBe("First line");
    expect(subjectFrom(null, "x".repeat(200))).toHaveLength(150);
  });

  it("reads audiences and the draft link", () => {
    expect(
      readMailchimpLists({ data: { lists: [{ id: "a", name: "Main" }, { name: "x" }] } }),
    ).toEqual([{ id: "a", name: "Main" }]);
    expect(mailchimpDraftUrl(123)).toBe("https://admin.mailchimp.com/campaigns/edit?id=123");
    expect(mailchimpDraftUrl("abc")).toBeNull();
  });

  it("never allows sending, scheduling or deleting", () => {
    const tools = integrationApp("mailchimp")!.tools.map((t) => t.slug);
    expect(tools.some((s) => /SEND|SCHEDULE/.test(s))).toBe(false);
    expect(tools.some((s) => DESTRUCTIVE_WORDS.some((w) => s.includes(w)))).toBe(false);
  });
});

describe("Google Sheets", () => {
  it("writes a header and the rows in date order, never as formulas", () => {
    const values = calendarValues([
      {
        date: "2026-11-05T09:00:00Z",
        channel: "instagram",
        status: "scheduled",
        title: null,
        text: "=SUM(A1)",
        link: null,
      },
      {
        date: "2026-11-04T09:00:00Z",
        channel: "facebook",
        status: "approved",
        title: "T",
        text: "Hi",
        link: "https://x",
      },
    ]);
    expect(values[0]).toEqual(["Date", "Channel", "Status", "Title", "Text", "Link"]);
    expect(values[1][0]).toBe("2026-11-04 09:00");
    expect(values[2][4]).toBe("'=SUM(A1)");
  });

  it("writes from A1 of the first sheet as raw values", () => {
    expect(sheetValuesArgs("s1", [["a"]])).toEqual({
      spreadsheet_id: "s1",
      valueInputOption: "RAW",
      data: [{ range: "A1", values: [["a"]] }],
    });
  });

  it("reads the new sheet's id and link", () => {
    expect(
      readSpreadsheet({
        data: { spreadsheetId: "abc", spreadsheetUrl: "https://docs.google.com/x" },
      }),
    ).toEqual({
      id: "abc",
      url: "https://docs.google.com/x",
    });
    expect(readSpreadsheet({ spreadsheet_id: "q" })?.url).toBe(
      "https://docs.google.com/spreadsheets/d/q/edit",
    );
    expect(readSpreadsheet({})).toBeNull();
  });
});

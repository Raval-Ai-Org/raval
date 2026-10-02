import { describe, expect, it } from "vitest";
import {
  entriesBetween,
  entryFromContent,
  filterEntries,
  fmtYMD,
  isHM,
  isLocked,
  isYMD,
  monthGrid,
  NO_FILTER,
  parseYMD,
  startOfWeek,
  toCalendarChannel,
  toCalendarStatus,
  type CalendarEntry,
  type CalendarSourceItem,
} from "./model";
import {
  calendarCsv,
  calendarIcs,
  calendarPrintHtml,
  calendarText,
  csvCell,
  exportFileName,
  foldIcsLine,
} from "./export";
import {
  buildPlanSlots,
  defaultsFor,
  MAX_PLAN_POSTS,
  maxPostsPerWeek,
  PLAN_INDUSTRIES,
  PLAN_TOPICS,
  PLAN_WEEK_OPTIONS,
  type PlanOptions,
} from "./planner";
import { momentsBetween } from "@/lib/studio/moments";

function row(over: Partial<CalendarSourceItem> = {}): CalendarSourceItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "post",
    channel: "instagram",
    title: "Autumn menu",
    body: "First line.\n\nMore.",
    hashtags: ["#autumn"],
    media_url: null,
    status: "draft",
    scheduled_at: null,
    meta: null,
    created_at: "2026-10-01T10:00:00.000Z",
    updated_at: "2026-10-09T10:00:00.000Z",
    ...over,
  };
}

function entry(over: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "a1",
    date: "2026-10-05",
    time: "09:00",
    channel: "instagram",
    format: "Post",
    title: "Autumn menu",
    caption: "First line.\nSecond line.",
    hashtags: ["#autumn", "#menu"],
    status: "draft",
    images: [],
    ...over,
  };
}

describe("calendar model", () => {
  it("validates dates and times", () => {
    expect(isYMD("2026-02-28")).toBe(true);
    expect(isYMD("2026-02-30")).toBe(false);
    expect(isYMD("26-2-1")).toBe(false);
    expect(isHM("23:59")).toBe(true);
    expect(isHM("24:00")).toBe(false);
  });

  it("maps stored channels and statuses, including ones it does not know", () => {
    expect(toCalendarChannel("twitter")).toBe("x");
    expect(toCalendarChannel("web")).toBe("blog");
    expect(toCalendarChannel("facebook")).toBe("facebook");
    expect(toCalendarChannel("myspace")).toBe("instagram");
    expect(toCalendarChannel(null)).toBe("instagram");
    expect(toCalendarStatus("pending")).toBe("review");
    expect(toCalendarStatus("partial_failed")).toBe("failed");
    expect(toCalendarStatus("rejected")).toBe("draft");
    expect(isLocked("scheduled")).toBe(true);
    expect(isLocked("approved")).toBe(false);
  });

  it("keeps a planned post on the day it was planned for", () => {
    const e = entryFromContent(
      row({
        meta: {
          calendar_date: "2026-10-20",
          calendar_time: "18:30",
          format: "Carousel",
          pillar: "Tips and how-tos",
        },
      }),
    );
    expect(e).toMatchObject({
      date: "2026-10-20",
      time: "18:30",
      format: "Carousel",
      topic: "Tips and how-tos",
    });
  });

  it("puts a scheduled post at its real time, over any planned day", () => {
    const at = new Date(2026, 10, 3, 14, 15);
    const e = entryFromContent(
      row({
        status: "scheduled",
        scheduled_at: at.toISOString(),
        meta: { calendar_date: "2026-10-20" },
      }),
    );
    expect(e).toMatchObject({ date: "2026-11-03", time: "14:15", status: "scheduled" });
  });

  it("falls back to the day a post was written, so an edit never moves it", () => {
    const e = entryFromContent(row({ meta: { calendar_date: "not-a-date" } }));
    expect(e.date).toBe(fmtYMD(new Date("2026-10-01T10:00:00.000Z")));
    expect(e.title).toBe("Autumn menu");
    expect(entryFromContent(row({ title: "  ", kind: "blog" }))).toMatchObject({
      title: "Untitled post",
      format: "Article",
    });
  });

  it("builds a Monday-first month grid", () => {
    const grid = monthGrid(new Date(2026, 9, 15));
    expect(grid).toHaveLength(42);
    expect(grid[0].getDay()).toBe(1);
    expect(fmtYMD(grid[0])).toBe("2026-09-28");
    expect(fmtYMD(startOfWeek(new Date(2026, 9, 4)))).toBe("2026-09-28"); // a Sunday
  });

  it("filters by channel, status and search text", () => {
    const list = [
      entry(),
      entry({ id: "a2", channel: "linkedin", status: "approved", title: "Hiring news" }),
      entry({ id: "a3", date: "2026-11-02", hashtags: ["#hiring"] }),
    ];
    expect(filterEntries(list, { ...NO_FILTER, channel: "linkedin" }).map((e) => e.id)).toEqual([
      "a2",
    ]);
    expect(filterEntries(list, { ...NO_FILTER, status: "draft" })).toHaveLength(2);
    expect(filterEntries(list, { ...NO_FILTER, query: " HIRING " }).map((e) => e.id)).toEqual([
      "a2",
      "a3",
    ]);
    expect(entriesBetween(list, "2026-10-01", "2026-10-31")).toHaveLength(2);
  });
});

describe("calendar exports", () => {
  it("quotes every cell and defuses spreadsheet formulas", () => {
    expect(csvCell('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe('"\'=HYPERLINK(1)"');
    expect(csvCell("+1 for this")).toBe('"\'+1 for this"');
    expect(csvCell("@mention")).toBe('"\'@mention"');
    expect(csvCell("plain")).toBe('"plain"');
  });

  it("writes one CSV row per post, in date order", () => {
    const csv = calendarCsv([
      entry({ id: "b", date: "2026-10-07", title: "Second" }),
      entry({ id: "a", images: ["data:image/png;base64,AAAA", "https://cdn.example/a.png"] }),
    ]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      '"Date","Day","Time","Channel","Type","Topic","Title","Caption","Hashtags","Status","Image"',
    );
    expect(lines[1]).toContain('"2026-10-05","Monday","09:00","Instagram","Post"');
    // A multi-line caption stays inside its quotes; only real links are exported.
    expect(csv).toContain('"First line.\nSecond line."');
    expect(lines[1].endsWith('"https://cdn.example/a.png"')).toBe(true);
    expect(lines[2]).toContain('"Second"');
  });

  it("writes a valid calendar file", () => {
    const ics = calendarIcs(
      [entry({ title: "Sale; 20% off, today", caption: "Line one\nLine two" })],
      { name: "Content calendar", now: new Date("2026-10-01T08:00:00Z") },
    );
    expect(ics.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics).toContain("UID:a1@calendar.mellox.ai");
    expect(ics).toContain("DTSTAMP:20261001T080000Z");
    expect(ics).toContain("DTSTART:20261005T090000");
    expect(ics).toContain("DTEND:20261005T093000");
    expect(ics).toContain("SUMMARY:Instagram: Sale\\; 20% off\\, today");
    expect(ics).toContain("Line one\\nLine two");
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });

  it("folds long lines without splitting a character", () => {
    const folded = foldIcsLine(`DESCRIPTION:${"é😀".repeat(40)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
    expect(parts.map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(
      `DESCRIPTION:${"é😀".repeat(40)}`,
    );
  });

  it("escapes post text in the printable page", () => {
    const page = calendarPrintHtml([entry({ title: "<script>alert(1)</script>" })], {
      title: "Content calendar",
    });
    expect(page).not.toContain("<script>alert(1)</script>");
    expect(page).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(page).toContain("Monday, 5 October 2026");
  });

  it("writes plain text grouped by day, and safe file names", () => {
    const text = calendarText([entry(), entry({ id: "c", date: "2026-10-06", title: "Next" })]);
    expect(text).toContain("Monday, 5 October 2026");
    expect(text).toContain("Tuesday, 6 October 2026");
    expect(exportFileName("", "2026-10", "csv")).toBe("content-calendar-2026-10.csv");
    expect(exportFileName("Acme & Co.", "All posts", "ics")).toBe(
      "acme-co-content-calendar-all-posts.ics",
    );
  });
});

describe("calendar planner", () => {
  const base: PlanOptions = {
    startDate: "2026-10-05", // a Monday
    weeks: 4,
    postsPerWeek: 4,
    channels: ["instagram", "linkedin", "x"],
    weekdays: [1, 2, 3, 4, 5],
    topics: ["tips", "product", "proof"],
    industry: "auto",
    keyDates: false,
  };

  it("makes exactly the posts asked for, in date order, on the chosen days", () => {
    const slots = buildPlanSlots(base);
    expect(slots).toHaveLength(16);
    expect(slots.map((s) => s.index)).toEqual(slots.map((_, i) => i));
    expect([...slots].sort((a, b) => a.date.localeCompare(b.date))).toEqual(slots);
    for (const s of slots) {
      expect(base.weekdays).toContain(parseYMD(s.date).getDay());
      expect(s.date >= "2026-10-05" && s.date <= "2026-11-01").toBe(true);
      expect(isHM(s.time)).toBe(true);
    }
    // Four posts in each of the four weeks.
    for (let w = 0; w < 4; w++) {
      const from = fmtYMD(new Date(2026, 9, 5 + w * 7));
      const to = fmtYMD(new Date(2026, 9, 11 + w * 7));
      expect(slots.filter((s) => s.date >= from && s.date <= to)).toHaveLength(4);
    }
  });

  it("shares posts across channels and follows the topic mix", () => {
    const slots = buildPlanSlots({ ...base, postsPerWeek: 6, weeks: 2 });
    const perChannel = (c: string) => slots.filter((s) => s.channel === c).length;
    expect(perChannel("instagram")).toBe(4);
    expect(perChannel("linkedin")).toBe(4);
    expect(perChannel("x")).toBe(4);
    const perTopic = (t: string) => slots.filter((s) => s.topic === t).length;
    // "auto" weights tips 3, product 2, proof 2.
    expect(perTopic("tips")).toBeGreaterThan(perTopic("product"));
    expect(perTopic("product")).toBeGreaterThan(0);
    expect(perTopic("proof")).toBeGreaterThan(0);
  });

  it("doubles up on a day, at different times, when there are more posts than days", () => {
    const slots = buildPlanSlots({
      ...base,
      weeks: 1,
      postsPerWeek: 4,
      weekdays: [1, 3],
      channels: ["instagram"],
    });
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map((s) => s.date))).toEqual(new Set(["2026-10-05", "2026-10-07"]));
    expect(new Set(slots.map((s) => `${s.date} ${s.time}`)).size).toBe(4);
  });

  it("uses every day when none is chosen, and refuses a bad start date", () => {
    expect(buildPlanSlots({ ...base, weekdays: [], weeks: 1, postsPerWeek: 7 })).toHaveLength(7);
    expect(buildPlanSlots({ ...base, startDate: "soon" })).toEqual([]);
  });

  it("ties a post to each key date in range, once", () => {
    const start = "2026-10-19";
    const moments = momentsBetween(start, "2026-11-15");
    expect(moments.map((m) => m.name)).toEqual(expect.arrayContaining(["Halloween", "Diwali"]));
    const slots = buildPlanSlots({ ...base, startDate: start, keyDates: true });
    const tied = slots.filter((s) => s.moment);
    expect(tied.map((s) => s.moment!.name)).toEqual(
      expect.arrayContaining(["Halloween", "Diwali"]),
    );
    for (const s of tied) expect(s.date <= s.moment!.date).toBe(true);
    expect(new Set(tied.map((s) => s.moment!.name)).size).toBe(tied.length);
    expect(buildPlanSlots({ ...base, startDate: start }).some((s) => s.moment)).toBe(false);
  });

  it("never offers a plan bigger than the cap", () => {
    for (const weeks of PLAN_WEEK_OPTIONS) {
      expect(weeks * maxPostsPerWeek(weeks)).toBeLessThanOrEqual(MAX_PLAN_POSTS);
    }
  });

  it("gives every kind of business usable starting choices", () => {
    const topicIds = new Set<string>(PLAN_TOPICS.map((t) => t.id));
    for (const industry of PLAN_INDUSTRIES) {
      const d = defaultsFor(industry.id);
      expect(d.channels.length, industry.id).toBeGreaterThan(0);
      expect(d.topics.length, industry.id).toBeGreaterThan(1);
      expect(
        Object.keys(industry.mix).every((t) => topicIds.has(t)),
        industry.id,
      ).toBe(true);
      expect(d.postsPerWeek).toBeLessThanOrEqual(maxPostsPerWeek(4));
    }
    expect(defaultsFor("does-not-exist")).toEqual(defaultsFor("auto"));
  });
});

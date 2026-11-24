import { describe, expect, it } from "vitest";
import { calendarCountries, countryOf, momentsBetween, upcomingMoments } from "./moments";

const keys = (list: { id: string }[]) => list.map((m) => m.id.replace(/-\d{4}$/, ""));

describe("culture calendar per country (Round 9)", () => {
  it("leaves the global calendar unchanged when no country is known", () => {
    const day = new Date("2026-10-20T00:00:00Z");
    expect(upcomingMoments(day, { limit: 10, country: null })).toEqual(
      upcomingMoments(day, { limit: 10 }),
    );
    expect(momentsBetween("2026-01-01", "2026-12-31", null)).toEqual(
      momentsBetween("2026-01-01", "2026-12-31"),
    );
  });

  it("adds a country's own national days", () => {
    const pk = keys(momentsBetween("2026-08-01", "2026-08-31", "PK"));
    expect(pk).toContain("pk-independence");
    expect(pk).not.toContain("in-independence");
    const inn = keys(momentsBetween("2026-08-01", "2026-08-31", "in"));
    expect(inn).toContain("in-independence");
    expect(keys(momentsBetween("2026-08-01", "2026-08-31"))).not.toContain("pk-independence");
  });

  it("keeps a market-only date to its markets", () => {
    expect(keys(momentsBetween("2026-10-01", "2026-11-05", "US"))).toContain("halloween");
    expect(keys(momentsBetween("2026-10-01", "2026-11-05", "PK"))).not.toContain("halloween");
    // Unknown country: global dates stay as they were.
    expect(keys(momentsBetween("2026-10-01", "2026-11-05"))).toContain("halloween");
  });

  it("computes rule-based dates correctly", () => {
    const find = (country: string, key: string, from: string, to: string) =>
      momentsBetween(from, to, country).find((m) => m.id.startsWith(`${key}-`))?.date;
    expect(find("GB", "gb-mothering-sunday", "2026-01-01", "2026-12-31")).toBe("2026-03-15");
    expect(find("US", "us-memorial-day", "2026-01-01", "2026-12-31")).toBe("2026-05-25");
    expect(find("US", "us-labor-day", "2026-01-01", "2026-12-31")).toBe("2026-09-07");
    expect(find("CA", "ca-thanksgiving", "2026-01-01", "2026-12-31")).toBe("2026-10-12");
    expect(find("BR", "br-carnaval", "2026-01-01", "2026-12-31")).toBe("2026-02-17");
  });

  it("reads the country from the site's domain, then the language", () => {
    expect(countryOf({ website: "https://shop.example.pk" })).toBe("PK");
    expect(countryOf({ website: "example.co.uk" })).toBe("GB");
    expect(countryOf({ website: "www.example.com.au/about" })).toBe("AU");
    expect(countryOf({ website: "https://example.com", language: "Urdu" })).toBe("PK");
    expect(countryOf({ website: "https://example.com", language: "English" })).toBeNull();
    expect(countryOf({ website: "not a url at all", language: null })).toBeNull();
    expect(countryOf({})).toBeNull();
  });

  it("lists the countries it has dates for", () => {
    const list = calendarCountries();
    for (const c of ["PK", "IN", "AE", "SA", "GB", "US", "BR"]) expect(list).toContain(c);
  });
});

import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("leaves plain text alone and empties null", () => {
    expect(csvCell("hello")).toBe("hello");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(42)).toBe("42");
    expect(csvCell(false)).toBe("false");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("one\ntwo")).toBe('"one\ntwo"');
  });

  it("neutralises formulas", () => {
    for (const bad of ["=SUM(A1)", "+1", "-2", "@cmd", "\tTab", "\rCR"]) {
      expect(csvCell(bad).replace(/^"/, "")).toMatch(/^'/);
    }
    expect(csvCell("=1+1")).toBe("'=1+1");
  });

  it("writes objects as JSON", () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
});

describe("toCsv", () => {
  it("writes a header and CRLF rows", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
  });
});

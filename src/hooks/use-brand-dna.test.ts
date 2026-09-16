// Brand DNA is kept per workspace id: Brand A's DNA can never be read under,
// merged into, or saved to Brand B — including when a save is still pending
// while the user switches brands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const saveBrandDna = vi.fn(async (_: { data: { workspaceId: string; dna: unknown } }) => ({}));
vi.mock("@/lib/brand-dna.functions", () => ({
  saveBrandDna: (arg: { data: { workspaceId: string; dna: unknown } }) => saveBrandDna(arg),
  getBrandDna: vi.fn(async () => null),
}));

const { emptyDna, readBrandDnaFor, resetBrandDnaStore, saveBrandDnaFor } =
  await import("./use-brand-dna");

const BRAND_A = "11111111-1111-4111-8111-111111111111";
const BRAND_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.useFakeTimers();
  saveBrandDna.mockClear();
  resetBrandDnaStore();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Brand DNA store", () => {
  it("starts every workspace empty — nothing carries over from another brand", () => {
    saveBrandDnaFor(BRAND_A, { brandName: "Mellox AI", voice: "precise", audience: "CMOs" });
    expect(readBrandDnaFor(BRAND_A).brandName).toBe("Mellox AI");
    const b = readBrandDnaFor(BRAND_B);
    expect(b.brandName).toBe("");
    expect(b.voice).toBe("");
    expect(b).toEqual(emptyDna);
  });

  it("a partial save merges only into its own workspace", () => {
    saveBrandDnaFor(BRAND_A, { brandName: "Mellox AI", voice: "precise" });
    saveBrandDnaFor(BRAND_B, { brandName: "Northwind Coffee" });
    expect(readBrandDnaFor(BRAND_B)).toMatchObject({ brandName: "Northwind Coffee", voice: "" });
    expect(readBrandDnaFor(BRAND_A)).toMatchObject({ brandName: "Mellox AI", voice: "precise" });
  });

  it("a debounced save still lands on the workspace it was made in after switching", async () => {
    saveBrandDnaFor(BRAND_A, { brandName: "Mellox AI" });
    // The user switches to Brand B and edits it before A's save fires.
    saveBrandDnaFor(BRAND_B, { brandName: "Northwind Coffee" });
    await vi.runAllTimersAsync();
    const calls = saveBrandDna.mock.calls.map(([arg]) => arg.data);
    expect(calls).toHaveLength(2);
    const a = calls.find((c) => c.workspaceId === BRAND_A);
    const b = calls.find((c) => c.workspaceId === BRAND_B);
    expect(a?.dna).toMatchObject({ brandName: "Mellox AI" });
    expect(b?.dna).toMatchObject({ brandName: "Northwind Coffee" });
  });

  it("no workspace id reads as empty and never writes", async () => {
    expect(readBrandDnaFor(null)).toEqual(emptyDna);
    await vi.runAllTimersAsync();
    expect(saveBrandDna).not.toHaveBeenCalled();
  });
});

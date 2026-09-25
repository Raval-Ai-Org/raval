import { describe, expect, it, vi } from "vitest";
import { runWithScope } from "@/server/request-context";
import { extractImageText } from "./vision-extract.server";

const BASE = "economy-model";
const ESCALATED = "workhorse-model";
const read = (text: string, escalated = false) => ({ text, model: escalated ? ESCALATED : BASE });

const image = (bytes: number, salt: string) =>
  `data:image/png;base64,${salt}${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

// A distinct user per test keeps the shared in-memory cache from leaking between cases.
const asUser = <T>(fn: () => Promise<T>) =>
  runWithScope({ userId: crypto.randomUUID(), route: "file-extract" }, fn);

describe("extractImageText", () => {
  it("reads on the route's base plan and serves a repeat of the same image from cache", async () => {
    const call = vi.fn().mockResolvedValue(read("Invoice #42 — total $1,280 due 30 Sept."));
    const dataUrl = image(50_000, "a");
    await asUser(async () => {
      const first = await extractImageText(dataUrl, call);
      const second = await extractImageText(dataUrl, call);
      expect(first).toMatchObject({ model: BASE, cached: false });
      expect(second).toMatchObject({ text: first.text, cached: true });
    });
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(false, dataUrl);
  });

  it("applies the route's escalation when a large image yields almost nothing", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce(read(""))
      .mockResolvedValueOnce(read("| Region | Q3 | Q4 |\n| North | 12 | 19 |", true));
    const result = await asUser(() => extractImageText(image(400_000, "b"), call));
    expect(call.mock.calls.map((c) => c[0])).toEqual([false, true]);
    expect(result).toMatchObject({ model: ESCALATED });
  });

  it("does not escalate a small image with little text", async () => {
    const call = vi.fn().mockResolvedValue(read("Logo"));
    const result = await asUser(() => extractImageText(image(20_000, "c"), call));
    expect(call).toHaveBeenCalledOnce();
    expect(result.text).toBe("Logo");
  });
});

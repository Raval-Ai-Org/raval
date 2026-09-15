import { describe, expect, it, vi } from "vitest";
import { runWithScope } from "@/server/request-context";
import { EXTRACTION_MODEL, FAST_CHAT_MODEL } from "@/lib/ai-gateway.server";
import { extractImageText } from "./vision-extract.server";

const image = (bytes: number, salt: string) =>
  `data:image/png;base64,${salt}${"A".repeat(Math.ceil((bytes * 4) / 3))}`;

// A distinct user per test keeps the shared in-memory cache from leaking between cases.
const asUser = <T>(fn: () => Promise<T>) =>
  runWithScope({ userId: crypto.randomUUID(), route: "file-extract" }, fn);

describe("extractImageText", () => {
  it("reads with the economy model and serves a repeat of the same image from cache", async () => {
    const call = vi.fn().mockResolvedValue("Invoice #42 — total $1,280 due 30 Sept.");
    const dataUrl = image(50_000, "a");
    await asUser(async () => {
      const first = await extractImageText(dataUrl, call);
      const second = await extractImageText(dataUrl, call);
      expect(first).toMatchObject({ model: FAST_CHAT_MODEL, cached: false });
      expect(second).toMatchObject({ text: first.text, cached: true });
    });
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(FAST_CHAT_MODEL, dataUrl);
  });

  it("escalates to the extraction model when a large image yields almost nothing", async () => {
    const call = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("| Region | Q3 | Q4 |\n| North | 12 | 19 |");
    const result = await asUser(() => extractImageText(image(400_000, "b"), call));
    expect(call.mock.calls.map((c) => c[0])).toEqual([FAST_CHAT_MODEL, EXTRACTION_MODEL]);
    expect(result).toMatchObject({ model: EXTRACTION_MODEL });
  });

  it("does not escalate a small image with little text", async () => {
    const call = vi.fn().mockResolvedValue("Logo");
    const result = await asUser(() => extractImageText(image(20_000, "c"), call));
    expect(call).toHaveBeenCalledOnce();
    expect(result.text).toBe("Logo");
  });
});

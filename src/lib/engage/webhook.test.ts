import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { validWebhookSignature, webhookAccounts } from "./webhook";

const SECRET = "app-secret";
const sig = (raw: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

describe("validWebhookSignature", () => {
  it("accepts Meta's signature and refuses anything else", () => {
    const raw = JSON.stringify({ object: "page", entry: [{ id: "1" }] });
    expect(validWebhookSignature(raw, sig(raw), SECRET)).toBe(true);
    expect(validWebhookSignature(raw + " ", sig(raw), SECRET)).toBe(false);
    expect(validWebhookSignature(raw, sig(raw, "other"), SECRET)).toBe(false);
    expect(validWebhookSignature(raw, null, SECRET)).toBe(false);
    expect(validWebhookSignature(raw, "sha1=abc", SECRET)).toBe(false);
  });
});

describe("webhookAccounts", () => {
  it("reads Page and Instagram ids, once each, and nothing else", () => {
    expect(
      webhookAccounts({ object: "page", entry: [{ id: "134" }, { id: 134 }, { id: "x" }] }),
    ).toEqual({ pageIds: ["134"], igIds: [] });
    expect(webhookAccounts({ object: "instagram", entry: [{ id: "178" }] })).toEqual({
      pageIds: [],
      igIds: ["178"],
    });
    expect(webhookAccounts({ object: "user", entry: [{ id: "1" }] })).toEqual({
      pageIds: [],
      igIds: [],
    });
    expect(webhookAccounts(null)).toEqual({ pageIds: [], igIds: [] });
  });
});

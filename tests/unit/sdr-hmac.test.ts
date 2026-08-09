// T007 — HMAC webhook verification (spec FR-021 / SC-009). The SDR signs the raw
// body: X-Signature-256 = "sha256=<hex>" of HMAC-SHA256(secret, "POST|/webhook|" + body).
import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { verifyWebhookSignature } from "@/lib/sdr.server";

function sign(secret: string, body: string): string {
  return "sha256=" + createHmac("sha256", secret).update(`POST|/webhook|${body}`).digest("hex");
}

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({ event: "post.published", data: { post_id: "p1" } });

  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature("ws-secret", body, sign("ws-secret", body))).toBe(true);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature("correct-secret", body, sign("wrong-secret", body))).toBe(false);
  });

  it("rejects a tampered body", () => {
    const sig = sign("secret", "original-body");
    expect(verifyWebhookSignature("secret", "tampered-body", sig)).toBe(false);
  });

  it("rejects a missing signature header", () => {
    expect(verifyWebhookSignature("secret", body, null)).toBe(false);
  });

  it("rejects a malformed / wrong-length header (constant-time safe)", () => {
    expect(verifyWebhookSignature("secret", body, "sha256=abc")).toBe(false);
    expect(verifyWebhookSignature("secret", body, "")).toBe(false);
  });
});

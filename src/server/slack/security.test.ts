import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey } from "@/server/crypto/secret-box.server";
import { matchesSlackState } from "./oauth.server";
import { safeEqualHex, sha256, slackText, verifySlackSignature } from "./security.server";

const secret = "signing-secret-for-test";
function headers(body: string, timestamp: number) {
  const digest = createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex");
  return new Headers({
    "x-slack-request-timestamp": String(timestamp),
    "x-slack-signature": `v0=${digest}`,
  });
}
describe("Slack request security", () => {
  it("accepts only the exact signed raw body inside the replay window", () => {
    const now = Date.now();
    const ts = Math.floor(now / 1000);
    const body = '{"type":"url_verification","challenge":"ok"}';
    expect(verifySlackSignature(body, headers(body, ts), secret, now)).toBe(true);
    expect(verifySlackSignature(`${body} `, headers(body, ts), secret, now)).toBe(false);
    expect(verifySlackSignature(body, headers(body, ts - 301), secret, now)).toBe(false);
    expect(verifySlackSignature(body, headers(body, ts + 301), secret, now)).toBe(false);
    const bad = headers(body, ts);
    bad.set("x-slack-signature", "v0=" + "0".repeat(64));
    expect(verifySlackSignature(body, bad, secret, now)).toBe(false);
    bad.set("x-slack-request-timestamp", "not-a-time");
    expect(verifySlackSignature(body, bad, secret, now)).toBe(false);
  });
  it("checks OAuth browser state without accepting malformed or absent cookies", () => {
    const state = randomBytes(48).toString("base64url");
    expect(matchesSlackState(state, sha256(state))).toBe(true);
    expect(matchesSlackState(state, undefined)).toBe(false);
    expect(matchesSlackState(state, sha256("other"))).toBe(false);
    expect(matchesSlackState("short", sha256("short"))).toBe(false);
    expect(safeEqualHex("no", sha256(state))).toBe(false);
  });
  it("encrypts installation tokens with authenticated encryption", () => {
    const key = randomBytes(32);
    const encrypted = encryptWithKey("xoxb-test-token", key);
    expect(encrypted).not.toContain("xoxb-test-token");
    expect(decryptWithKey(encrypted, key)).toBe("xoxb-test-token");
    expect(() => decryptWithKey(encrypted, randomBytes(32))).toThrow();
  });
  it("escapes Slack text rather than interpreting content as markup", () => {
    expect(slackText("<@U123> & <script>")).toBe("&lt;@U123&gt; &amp; &lt;script&gt;");
  });
});

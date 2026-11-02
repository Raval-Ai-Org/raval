import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignedInstance } from "./signed-instance.server";

const SECRET = "test-app-secret";
const INSTANCE = "bf296da1-75ce-48e6-9f72-14b7148d4fa2";
const NOW = Date.parse("2026-11-02T12:00:00Z");

function sign(data: Record<string, unknown>, secret = SECRET) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${sig}.${payload}`;
}

const claims = {
  instanceId: INSTANCE,
  signDate: "2026-11-02T11:58:00.000Z",
  uid: "u1",
  permissions: "OWNER",
  siteOwnerId: "u1",
};

describe("verifySignedInstance", () => {
  it("accepts a fresh instance signed with the app secret", () => {
    expect(verifySignedInstance(sign(claims), SECRET, INSTANCE, NOW)).toEqual({
      instanceId: INSTANCE,
      signDate: claims.signDate,
      siteOwnerId: "u1",
      uid: "u1",
      permissions: "OWNER",
    });
  });

  it("refuses another secret, another instance id or a tampered payload", () => {
    expect(verifySignedInstance(sign(claims, "other"), SECRET, INSTANCE, NOW)).toBeNull();
    expect(
      verifySignedInstance(sign(claims), SECRET, "00000000-0000-0000-0000-000000000000", NOW),
    ).toBeNull();
    const [sig] = sign(claims).split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, uid: "evil" })).toString("base64url");
    expect(verifySignedInstance(`${sig}.${forged}`, SECRET, INSTANCE, NOW)).toBeNull();
  });

  it("refuses an old signature and malformed input", () => {
    expect(
      verifySignedInstance(
        sign({ ...claims, signDate: "2026-11-02T10:00:00.000Z" }),
        SECRET,
        INSTANCE,
        NOW,
      ),
    ).toBeNull();
    expect(verifySignedInstance("nodot", SECRET, INSTANCE, NOW)).toBeNull();
    expect(verifySignedInstance(".x", SECRET, INSTANCE, NOW)).toBeNull();
    expect(verifySignedInstance(sign(claims), "", INSTANCE, NOW)).toBeNull();
  });
});

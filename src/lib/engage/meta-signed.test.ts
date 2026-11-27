import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { deletionCode, parseSignedRequest, readDeletionCode } from "./meta-signed";

const SECRET = "app-secret";

function sign(payload: object, secret = SECRET) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${sig}.${body}`;
}

describe("parseSignedRequest", () => {
  it("reads a request Meta signed", () => {
    const out = parseSignedRequest(
      sign({ algorithm: "HMAC-SHA256", user_id: "122136541695275360", issued_at: 1795000000 }),
      SECRET,
    );
    expect(out).toEqual({ userId: "122136541695275360", issuedAt: 1795000000 });
  });

  it("refuses another secret, a changed body and a bad algorithm", () => {
    const good = sign({ algorithm: "HMAC-SHA256", user_id: "1" });
    expect(parseSignedRequest(good, "other")).toBeNull();
    const [sig] = good.split(".");
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "2" })).toString(
      "base64url",
    );
    expect(parseSignedRequest(`${sig}.${forged}`, SECRET)).toBeNull();
    expect(parseSignedRequest(sign({ algorithm: "none", user_id: "1" }), SECRET)).toBeNull();
    expect(
      parseSignedRequest(sign({ algorithm: "HMAC-SHA256", user_id: "x'1" }), SECRET),
    ).toBeNull();
    expect(parseSignedRequest("", SECRET)).toBeNull();
    expect(parseSignedRequest("a.b.c", SECRET)).toBeNull();
  });
});

describe("deletion codes", () => {
  it("round-trips and refuses a made-up code", () => {
    const at = Date.parse("2026-11-27T12:00:00Z");
    const code = deletionCode(at, SECRET);
    expect(readDeletionCode(code, SECRET)).toBe(at);
    expect(readDeletionCode(code, "other")).toBeNull();
    expect(readDeletionCode(code.slice(0, -1) + "A", SECRET)).toBeNull();
    expect(readDeletionCode("nope", SECRET)).toBeNull();
  });
});

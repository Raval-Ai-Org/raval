// T008 — idempotency key derivation (spec FR-006/SC-003, FR-023). The SDR key
// identifies a JOB (one item → its target accounts). Same inputs → same job
// (no duplicate). Different target set OR new sdr_revision → fresh job.
import { describe, it, expect } from "vitest";
import { deriveIdempotencyKey, targetFingerprint } from "@/lib/sdr.server";

describe("deriveIdempotencyKey", () => {
  const fp = targetFingerprint(["acc-1", "acc-2"]);
  const base = {
    contentItemId: "item-123",
    platform: "twitter",
    targetFingerprint: fp,
    revision: 0,
  };

  it("produces the expected publish format", () => {
    expect(deriveIdempotencyKey({ kind: "publish", ...base })).toBe(
      `publish:item-123:twitter:${fp}:0`,
    );
  });

  it("same inputs → same key (idempotent submit)", () => {
    expect(deriveIdempotencyKey({ kind: "publish", ...base })).toBe(
      deriveIdempotencyKey({ kind: "publish", ...base }),
    );
  });

  it("target-set order does not change the key (canonical fingerprint)", () => {
    expect(targetFingerprint(["acc-1", "acc-2"])).toBe(targetFingerprint(["acc-2", "acc-1"]));
  });

  it("different target set → different key (a new job)", () => {
    const otherFp = targetFingerprint(["acc-1"]);
    expect(deriveIdempotencyKey({ kind: "publish", ...base })).not.toBe(
      deriveIdempotencyKey({ kind: "publish", ...base, targetFingerprint: otherFp }),
    );
  });

  it("different platform → different key", () => {
    expect(deriveIdempotencyKey({ kind: "publish", ...base })).not.toBe(
      deriveIdempotencyKey({ kind: "publish", ...base, platform: "linkedin" }),
    );
  });

  it("schedule kind differs from publish kind", () => {
    expect(deriveIdempotencyKey({ kind: "schedule", ...base })).not.toBe(
      deriveIdempotencyKey({ kind: "publish", ...base }),
    );
  });

  it("revision increment → fresh key (republish-after-failure, FR-023)", () => {
    expect(deriveIdempotencyKey({ kind: "publish", ...base, revision: 1 })).not.toBe(
      deriveIdempotencyKey({ kind: "publish", ...base, revision: 0 }),
    );
  });

  it("stays under the SDR 128-char idempotency-key limit", () => {
    const long = {
      contentItemId: "i".repeat(36),
      platform: "instagram",
      targetFingerprint: "f".repeat(16),
      revision: 999999,
    };
    expect(deriveIdempotencyKey({ kind: "schedule", ...long }).length).toBeLessThanOrEqual(128);
  });
});

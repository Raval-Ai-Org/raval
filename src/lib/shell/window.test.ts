import { describe, expect, it } from "vitest";
import { clearStaleBodyPointerEvents, OPEN_MODAL_SELECTOR } from "./window";

describe("body pointer-lock recovery", () => {
  it("only keeps the lock for active modal surfaces", () => {
    expect(OPEN_MODAL_SELECTOR).not.toContain("data-aria-hidden");
    expect(OPEN_MODAL_SELECTOR).not.toContain("data-radix-popper-content-wrapper");
    expect(OPEN_MODAL_SELECTOR).toContain(':not([data-modal="false"])');
  });

  it("clears a stale lock but preserves an active modal lock", () => {
    const body = { style: { pointerEvents: "none" } };

    clearStaleBodyPointerEvents(body, true);
    expect(body.style.pointerEvents).toBe("none");

    clearStaleBodyPointerEvents(body, false);
    expect(body.style.pointerEvents).toBe("");
  });
});

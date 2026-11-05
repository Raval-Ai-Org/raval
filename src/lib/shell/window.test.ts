import { describe, expect, it } from "vitest";
import { clearStaleBodyPointerEvents, OPEN_MODAL_SELECTOR } from "./window";

describe("body pointer-lock recovery", () => {
  it("only recognizes surfaces explicitly marked modal", () => {
    expect(OPEN_MODAL_SELECTOR).toContain('[data-modal="true"][data-state="open"]');
    expect(OPEN_MODAL_SELECTOR).toContain('[aria-modal="true"]:not([data-state="closed"])');
    expect(OPEN_MODAL_SELECTOR).not.toContain('[role="dialog"]');
    expect(OPEN_MODAL_SELECTOR).not.toContain("data-radix-popper-content-wrapper");
  });

  it("clears a stale lock but preserves an active modal lock", () => {
    const body = { style: { pointerEvents: "none" } };

    clearStaleBodyPointerEvents(body, true);
    expect(body.style.pointerEvents).toBe("none");

    clearStaleBodyPointerEvents(body, false);
    expect(body.style.pointerEvents).toBe("");
  });
});

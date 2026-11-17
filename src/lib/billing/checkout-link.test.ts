import { describe, expect, it } from "vitest";
import { checkoutHref, readCheckoutLink, safeReturnPath } from "./checkout-link";

const read = (href: string) => readCheckoutLink(new URL(href, "https://x.test").searchParams);

describe("checkout link", () => {
  it("round-trips a plan with its reason", () => {
    const link = read(
      checkoutHref({
        item: { kind: "plan", key: "growth", interval: "month" },
        block: { code: "upgrade_required", feature: "campaigns", requiredPlan: "growth" },
        from: "/w/abc12345/app",
        workspaceId: "abc12345",
      }),
    );
    expect(link.step).toBe("pay");
    expect(link.item).toEqual({ kind: "plan", key: "growth", interval: "month" });
    expect(link.block?.feature).toBe("campaigns");
    expect(link.from).toBe("/w/abc12345/app");
    expect(link.workspaceId).toBe("abc12345");
  });

  it("opens the plan step without an item, yearly by default", () => {
    const link = read(checkoutHref({ from: "/projects" }));
    expect(link.step).toBe("plan");
    expect(link.interval).toBe("year");
    expect(link.item).toBeNull();
  });

  it("keeps credit packs on the credits view", () => {
    const link = read(checkoutHref({ item: { kind: "credit_pack", key: "credits_200" } }));
    expect(link.view).toBe("credits");
    expect(link.item).toEqual({ kind: "credit_pack", key: "credits_200" });
  });

  it("refuses unknown plans, packs and sessions", () => {
    expect(read("/checkout?step=pay&kind=plan&key=free").step).toBe("plan");
    expect(read("/checkout?step=pay&kind=credit_pack&key=nope").item).toBeNull();
    expect(read("/checkout?step=launch&checkout_session_id=evil").step).toBe("plan");
    expect(read("/checkout?step=launch&checkout_session_id=cs_live_abc123").step).toBe("launch");
  });

  it("never returns to another site", () => {
    expect(safeReturnPath("//evil.com")).toBe("/projects");
    expect(safeReturnPath("https://evil.com")).toBe("/projects");
    expect(safeReturnPath("/checkout?step=pay")).toBe("/projects");
    expect(safeReturnPath("/w/a/app/brain")).toBe("/w/a/app/brain");
  });
});

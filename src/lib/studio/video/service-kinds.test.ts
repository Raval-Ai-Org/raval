import { describe, expect, it } from "vitest";
import { pickVideoKind, usableKind } from "./kinds";

describe("round 9 video pack: services", () => {
  it("never gives a service with no product a product-only video", () => {
    expect(pickVideoKind("Show our boiler repair service", {})).toBe("product-motion");
    expect(pickVideoKind("Show our boiler repair service", { service: true })).toBe("how-it-works");
    expect(usableKind("product-showcase", { service: true })).toBe("how-it-works");
    // A service that sells a catalogue product keeps the product film.
    expect(pickVideoKind("Our new filter", { service: true, product: true })).toBe(
      "product-motion",
    );
  });
});

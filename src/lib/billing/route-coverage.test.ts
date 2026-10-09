import { describe, expect, it } from "vitest";
import { CREDIT_ACTIONS, INCLUDED_ROUTES } from "./catalog";
import { registeredRoutes } from "@/server/ai/task-models";

function covers(label: string, route: string) {
  return route === label || (route.endsWith(".*") && label.startsWith(route.slice(0, -1)));
}

describe("billing route coverage", () => {
  it("prices uploaded-media captions through the existing ideas action", () => {
    expect(CREDIT_ACTIONS.ideas.routes).toContain("studio.upload-captions");
  });

  it("maps every model route to a paid action or included work", () => {
    const paid = Object.values(CREDIT_ACTIONS).flatMap((action) => action.routes);
    const unmapped = registeredRoutes().filter(
      (label) => ![...paid, ...INCLUDED_ROUTES].some((route) => covers(label, route)),
    );
    expect(unmapped).toEqual([]);
  });
});

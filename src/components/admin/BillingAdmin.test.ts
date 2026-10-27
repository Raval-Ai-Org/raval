import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ search: "", keys: [] as unknown[][] }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
    state.keys.push(queryKey);
    if (queryKey[2] === "access") return { isSuccess: true, data: { report: {} } };
    if (queryKey[2] === "account")
      return {
        data: {
          account: {
            id: queryKey[3],
            ownerUserId: "actual-owner",
            email: "paid@example.com",
            plan: "starter",
            status: "active",
            wallet: null,
            brands: [],
            ledger: [],
            grants: [],
            activations: [],
          },
        },
      };
    return { data: { requests: [] } };
  },
}));

import { BillingAdmin } from "./BillingAdmin";

describe("billing account deep links", () => {
  const accountId = "f2a43092-c355-45a9-b8a5-0021c1188e43";
  beforeEach(() => {
    state.search = "";
    state.keys = [];
  });

  it("opens the purchased account and its exact owner from an activity link", () => {
    state.search = `account=${accountId}`;
    const html = renderToStaticMarkup(createElement(BillingAdmin));
    expect(state.keys).toContainEqual(["admin", "billing", "account", accountId]);
    expect(html).toContain("paid@example.com");
    expect(html).toContain("/admin/users/actual-owner");
    expect(html).not.toContain("People who clicked Upgrade now");
  });

  it("loads another account when the URL changes", () => {
    state.search = `account=${accountId}`;
    renderToStaticMarkup(createElement(BillingAdmin));
    const second = "0896a2f2-87d4-4861-955c-2274f62fa3cc";
    state.search = `account=${second}`;
    renderToStaticMarkup(createElement(BillingAdmin));
    expect(state.keys).toContainEqual(["admin", "billing", "account", second]);
  });

  it.each(["", "account=invalid"])('keeps the requests view for "%s"', (search) => {
    state.search = search;
    const html = renderToStaticMarkup(createElement(BillingAdmin));
    expect(html).toContain("People who clicked Upgrade now");
    expect(state.keys.some((key) => key[2] === "account")).toBe(false);
  });
});

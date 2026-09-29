"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { onAppEvent } from "@/lib/app-events";
import { authedFetch } from "@/lib/authed-fetch";

export type BillingNotice = {
  id: string;
  kind: string;
  title: string | null;
  read: boolean;
  at: string;
};

const KEY = ["billing", "notices"] as const;

/** The signed-in person's billing notices (low balance, requests, plan changes). */
export function useBillingNotices(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery<{ notices: BillingNotice[]; unread: number }>({
    queryKey: KEY,
    queryFn: async () => {
      const response = await authedFetch("/api/billing/notifications", { workspaceId: null });
      if (!response.ok) return { notices: [], unread: 0 };
      return response.json();
    },
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  useEffect(
    () =>
      onAppEvent("billing:changed", () => {
        void queryClient.invalidateQueries({ queryKey: KEY });
      }),
    [queryClient],
  );
  return query;
}

export async function markNoticesRead(): Promise<void> {
  await authedFetch("/api/billing/notifications", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
    workspaceId: null,
  }).catch(() => undefined);
}

/** Plain title for notices stored without one. */
export function noticeTitle(notice: BillingNotice): string {
  if (notice.title) return notice.title;
  switch (notice.kind) {
    case "upgrade_request":
      return "A teammate asked for an upgrade";
    case "plan_activated":
      return "Your plan was updated";
    case "meter_80":
      return "You've used most of your balance";
    case "meter_100":
      return "Your balance is used up";
    case "comp_ending":
      return "Your plan ends soon";
    case "referral_reward":
      return "You earned a referral reward";
    case "launch_grace":
      return "A free month on us";
    default:
      return "Billing update";
  }
}

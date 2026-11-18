"use client";

// No plan, no app (pricing v4, ADR-0050). After sign-in, before any workspace
// list, onboarding or app screen draws, the person's access is checked once
// (`/api/billing/access`); with no plan they go straight to the full checkout
// (plans, a trial code, payment). Members of a paid brand and Mellox staff go
// in. The server refuses paid work on its own either way; a failed check here
// lets the page draw rather than locking a paying person out.

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/page-loader";
import { authedFetch } from "@/lib/authed-fetch";
import { checkoutHref } from "@/lib/billing/checkout-link";

export function PlanGate({
  workspaceId,
  children,
}: {
  workspaceId?: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
        const response = await authedFetch(`/api/billing/access${query}`, {
          workspaceId: workspaceId ?? null,
        });
        const body = (await response.json().catch(() => null)) as { needsPlan?: boolean } | null;
        if (!live) return;
        if (response.ok && body?.needsPlan) {
          router.replace(
            checkoutHref({
              required: true,
              from: `${window.location.pathname}${window.location.search}`,
              workspaceId: workspaceId ?? null,
              recommended: "growth",
            }),
          );
          return;
        }
      } catch {
        /* fail open: the server still refuses paid work */
      }
      if (live) setReady(true);
    })();
    return () => {
      live = false;
    };
    // One check per place; moving inside a workspace keeps the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  if (!ready) return <PageLoader />;
  return <>{children}</>;
}

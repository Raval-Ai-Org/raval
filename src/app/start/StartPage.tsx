"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { PageLoader } from "@/components/ui/page-loader";
import { useCreateWorkspace } from "@/hooks/use-create-workspace";
import { ServerFnError } from "@/lib/rpc-client";
import { toast } from "@/lib/toast";
import { nameFromDomain, normalizeDomain, toWebsiteUrl } from "@/lib/workspace/domain";
import { onboardingPath, WORKSPACES_HOME } from "@/lib/workspace/paths";

/**
 * Turns the website in `?url=` into a workspace and opens its setup, which
 * starts the Brand DNA scan by itself. The create is idempotent and returns
 * the person's existing workspace for the same domain, so a refresh or a
 * second visit never makes a copy; setup sends an already set-up brand on to
 * its app. Anything that goes wrong lands on the workspace list.
 */
export default function StartPage() {
  const router = useRouter();
  const { create } = useCreateWorkspace();

  useEffect(() => {
    let cancelled = false;
    const websiteUrl = toWebsiteUrl(new URLSearchParams(window.location.search).get("url"));
    if (!websiteUrl) {
      router.replace(WORKSPACES_HOME);
      return;
    }
    create({ name: nameFromDomain(normalizeDomain(websiteUrl)), websiteUrl })
      .then((workspace) => {
        if (!cancelled) router.replace(onboardingPath(workspace.id));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A plan limit (402) already shows its own notice with a button.
        if (!(error instanceof ServerFnError && error.status === 402)) {
          toast.error("We couldn't set up that website", {
            description: "Paste the link here to try again.",
          });
        }
        router.replace(WORKSPACES_HOME);
      });
    return () => {
      cancelled = true;
    };
  }, [create, router]);

  return <PageLoader label="Setting up your brand…" />;
}

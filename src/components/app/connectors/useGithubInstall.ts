"use client";

// useGithubInstall — connects GitHub in this tab. The server returns GitHub's
// authorize page (or the App install page); GitHub sends the user back to
// /integrations/github/callback on this same origin, which saves and verifies
// the connection and then returns to `returnPath`. Shared by Settings →
// Connections and AI Visibility's "Connect GitHub" step.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { startGithubInstall } from "@/lib/connectors.functions";

export const CONNECTIONS_RETURN_PATH = "/app?settings=connections";

export function useGithubInstall(
  workspaceId: string,
  returnPath: string = CONNECTIONS_RETURN_PATH,
) {
  const [installing, setInstalling] = useState(false);

  // Back from GitHub via the browser's Back button restores this page from cache.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setInstalling(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const install = useCallback(async () => {
    setInstalling(true);
    try {
      const { url } = await startGithubInstall({
        data: { workspaceId, returnOrigin: window.location.origin, returnPath },
      });
      window.location.assign(url);
    } catch (e) {
      setInstalling(false);
      toast.error(e instanceof Error ? e.message : "Couldn't start the GitHub connection");
    }
  }, [workspaceId, returnPath]);

  return { installing, install };
}

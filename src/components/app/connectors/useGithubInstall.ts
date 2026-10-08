"use client";

// useGithubInstall — connects GitHub in a small sign-in window. The server
// returns GitHub's authorize page (or the App install page); GitHub sends the
// window back to /integrations/github/callback on this origin, which saves and
// verifies the connection, tells this page and closes. `onDone` then re-reads
// the connection. Shared by Settings → Connections and AI Visibility's
// "Connect GitHub" step.
import { inWorkspace } from "@/lib/workspace/paths";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
import { startGithubInstall } from "@/lib/connectors.functions";
import type { ConnectResult } from "@/lib/connectors/connect-window";
import { useConnectWindow } from "./useConnectWindow";

export const CONNECTIONS_RETURN_PATH = "/app?settings=connections";

export function useGithubInstall(
  workspaceId: string,
  returnPath: string = CONNECTIONS_RETURN_PATH,
  onDone?: (result: ConnectResult | null) => void,
) {
  const [starting, setStarting] = useState(false);
  const { waiting, connect } = useConnectWindow("github", workspaceId, (result) => {
    if (result?.status === "connected") toast.success("GitHub connected");
    onDone?.(result);
  });

  // Back from GitHub via the browser's Back button restores this page from cache.
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setStarting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const install = useCallback(async () => {
    setStarting(true);
    try {
      // Return into THIS workspace, not whichever one is open when GitHub
      // sends the user back.
      await connect(async () => {
        const { url } = await startGithubInstall({
          data: {
            workspaceId,
            returnOrigin: window.location.origin,
            returnPath: inWorkspace(workspaceId, returnPath),
          },
        });
        return url;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't start the GitHub connection");
    } finally {
      setStarting(false);
    }
  }, [workspaceId, returnPath, connect]);

  return { installing: starting || waiting, waiting, install };
}

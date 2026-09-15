"use client";

// useGithubInstall — starts the GitHub App install in a popup and reports back
// when it connects, fails, or is abandoned. Shared by Settings → Connections
// and a finding's "Connect GitHub" step.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { startGithubInstall, subscribeConnectors } from "@/lib/connectors.functions";

type Handlers = {
  /** The callback page saved the connection. */
  onConnected: () => void;
  /** The flow ended without a success message (error, popup closed) — reload from the server. */
  onSettled?: () => void;
};

export function useGithubInstall(workspaceId: string, handlers: Handlers) {
  const [installing, setInstalling] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(
    () =>
      subscribeConnectors((message) => {
        if (message.provider !== "github") return;
        popupRef.current = null;
        setInstalling(false);
        if (message.type === "connected") {
          toast.success("GitHub connected");
          handlersRef.current.onConnected();
        } else {
          toast.error(message.message);
          handlersRef.current.onSettled?.();
        }
      }),
    [],
  );

  // The popup was closed before finishing (or the result couldn't be broadcast):
  // stop waiting and show whatever the server has.
  useEffect(() => {
    if (!installing) return;
    const timer = window.setInterval(() => {
      const popup = popupRef.current;
      if (popup && popup.closed) {
        popupRef.current = null;
        setInstalling(false);
        handlersRef.current.onSettled?.();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [installing]);

  const install = useCallback(async () => {
    setInstalling(true);
    // Open synchronously (popup blockers), then point it at GitHub.
    const popup = window.open(
      "about:blank",
      "mellox-github-install",
      "popup,width=1020,height=760",
    );
    popupRef.current = popup;
    try {
      const { url } = await startGithubInstall({
        data: { workspaceId, returnOrigin: window.location.origin },
      });
      if (popup && !popup.closed) popup.location.href = url;
      else window.location.assign(url);
    } catch (e) {
      popup?.close();
      popupRef.current = null;
      setInstalling(false);
      toast.error(e instanceof Error ? e.message : "Couldn't start the GitHub connection");
    }
  }, [workspaceId]);

  return { installing, install };
}

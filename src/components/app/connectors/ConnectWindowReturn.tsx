"use client";

// ConnectWindowReturn — closes a sign-in window that a provider sent straight
// back into the app (Slack and Notion finish on the server and redirect to a
// workspace page). The callback pages under /integrations close themselves.
import { useEffect, useState } from "react";
import { connectWindowProvider, finishConnectWindow } from "@/lib/connectors/connect-window";
import { isWorkspaceId } from "@/lib/workspace/paths";

const NOTION_RESULT = "/integrations/notion/result";

export function ConnectWindowReturn() {
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const provider = connectWindowProvider();
    if (!provider) return;
    const { pathname, search } = window.location;
    const params = new URLSearchParams(search);
    const inApp = pathname.startsWith("/w/") || pathname === "/projects";
    if (!inApp && pathname !== NOTION_RESULT) return;

    const flag = pathname === NOTION_RESULT ? params.get("status") : params.get(provider);
    const workspaceId = pathname.split("/")[2] ?? "";
    setClosing(true);
    if (!flag) {
      // No result to report: the page that opened this re-reads when it is focused.
      window.close();
      return;
    }
    finishConnectWindow({
      provider,
      status: flag === "connected" ? "connected" : flag === "cancelled" ? "cancelled" : "error",
      workspaceId: pathname.startsWith("/w/") && isWorkspaceId(workspaceId) ? workspaceId : null,
    });
  }, []);

  if (!closing) return null;
  return (
    <div className="fixed inset-0 z-[300] grid place-items-center bg-background text-sm text-muted-foreground">
      You can close this window.
    </div>
  );
}

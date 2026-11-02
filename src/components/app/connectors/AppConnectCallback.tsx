"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeAppConnect } from "@/lib/integrations.functions";
import { integrationApp } from "@/lib/integrations/catalog";
import {
  announceConnectResult,
  finishConnectWindow,
  isConnectWindow,
} from "@/lib/connectors/connect-window";
import { inWorkspace, workspacePath } from "@/lib/workspace/paths";

type Result = Awaited<ReturnType<typeof completeAppConnect>>;

/** Where Composio sends a person back after signing in to an app. */
export function AppConnectCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inWindow, setInWindow] = useState(false);
  useEffect(() => setInWindow(isConnectWindow()), []);

  const name = result ? (integrationApp(result.app)?.name ?? "The app") : "The app";
  const back = result
    ? inWorkspace(
        result.workspaceId,
        result.returnPath ?? workspacePath(result.workspaceId, "", { tab: "overview" }),
      )
    : "/projects";

  const leave = (value: Result | null = result) => {
    if (
      value &&
      finishConnectWindow({
        provider: "apps",
        status: value.status === "connected" ? "connected" : "error",
        workspaceId: value.workspaceId,
        accounts: value.label ? [value.label] : undefined,
      })
    )
      return;
    if (inWindow) window.close();
    else window.location.replace(back);
  };

  useEffect(() => {
    if (error && inWindow) announceConnectResult({ provider: "apps", status: "error" });
  }, [error, inWindow]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const accountId = search.get("connected_account_id") ?? "";
    if (search.get("status") === "failed" && !accountId) {
      setError("The sign-in was cancelled or didn't finish.");
      return;
    }
    if (!state || !accountId) {
      setError("This page was opened without a connection request.");
      return;
    }
    void completeAppConnect({ data: { state, connectedAccountId: accountId } })
      .then((value) => {
        window.history.replaceState(null, "", window.location.pathname);
        setResult(value);
        if (value.status === "connected") leave(value);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "The connection didn't finish."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const failed = error || result?.status === "error";
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <h1 className="text-base font-semibold">
          {failed ? "Couldn't connect" : result ? `${name} connected` : "Connecting…"}
        </h1>
        {!result && !error && (
          <p className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Finishing up…
          </p>
        )}
        {failed && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-destructive">
              {error ?? `${name} didn't finish signing in. Try again from Mellox.`}
            </p>
            <Button onClick={() => leave()}>{inWindow ? "Close" : "Return to Mellox"}</Button>
          </div>
        )}
        {result?.status === "connected" && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">{result.label}</p>
            <Button onClick={() => leave()}>{inWindow ? "Close" : "Return to Mellox"}</Button>
          </div>
        )}
      </section>
    </main>
  );
}

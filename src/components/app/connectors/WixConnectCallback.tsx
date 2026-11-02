"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Globe, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeWixConnect } from "@/lib/wix.functions";
import {
  announceConnectResult,
  finishConnectWindow,
  isConnectWindow,
} from "@/lib/connectors/connect-window";
import { inWorkspace, workspacePath } from "@/lib/workspace/paths";

type Result = Awaited<ReturnType<typeof completeWixConnect>>;

/** The page Wix's installer returns to. Wix has one site per install, so there is nothing to choose. */
export function WixConnectCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inWindow, setInWindow] = useState(false);
  useEffect(() => setInWindow(isConnectWindow()), []);
  useEffect(() => {
    if (error && inWindow) announceConnectResult({ provider: "wix", status: "error" });
  }, [error, inWindow]);

  const back = result
    ? inWorkspace(
        result.workspaceId,
        result.returnPath ?? workspacePath(result.workspaceId, "", { tab: "overview" }),
      )
    : "/projects";

  // In a sign-in window: tell the page that opened it and close. Else go back.
  const leave = () => {
    if (
      result &&
      finishConnectWindow({
        provider: "wix",
        status: "connected",
        workspaceId: result.workspaceId,
        accounts: result.connection.site ? [result.connection.site.name] : undefined,
      })
    )
      return;
    if (inWindow) window.close();
    else window.location.replace(back);
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const instanceId = search.get("instanceId") ?? "";
    const signedInstance = search.get("signedInstance") ?? "";
    if (search.get("error")) {
      setError("Wix didn't add Mellox to your site.");
      return;
    }
    if (!state) {
      setError("This page was opened without a Wix connection request.");
      return;
    }
    // Wix leaves these out when the install was cancelled.
    if (!instanceId || !signedInstance) {
      setError("Mellox wasn't added to your Wix site. Try again and allow it at the end.");
      return;
    }
    void completeWixConnect({ data: { state, instanceId, signedInstance } })
      .then((value) => {
        window.history.replaceState(null, "", window.location.pathname);
        setResult(value);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Wix connection failed."));
  }, [search]);

  const site = result?.connection.site ?? null;
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-secondary">
            <Globe className="size-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Wix</p>
            <h1 className="text-base font-semibold">
              {error ? "Couldn't connect Wix" : result ? "Wix connected" : "Connecting Wix"}
            </h1>
          </div>
        </div>
        {!result && !error && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Finishing up…
          </p>
        )}
        {error && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button onClick={leave}>{inWindow ? "Close" : "Return to Mellox"}</Button>
          </div>
        )}
        {result && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-border/70 px-3 py-2.5">
              <p className="text-sm font-semibold">{site?.name ?? "Your Wix site"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {site?.url?.replace(/^https?:\/\//, "") ?? "Not published yet"}
              </p>
            </div>
            <Button onClick={leave}>Done</Button>
          </div>
        )}
      </section>
    </main>
  );
}

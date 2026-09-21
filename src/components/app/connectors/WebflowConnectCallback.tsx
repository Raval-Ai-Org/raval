"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle, Globe, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { completeWebflowConnect, selectWebflowSite } from "@/lib/webflow.functions";
import { inWorkspace, workspacePath } from "@/lib/workspace/paths";

type Result = Awaited<ReturnType<typeof completeWebflowConnect>>;
export function WebflowConnectCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    const denied = search.get("error");
    if (denied) {
      setError(
        denied === "access_denied"
          ? "Webflow authorization was cancelled."
          : "Webflow could not authorize Mellox.",
      );
      return;
    }
    if (!state || !code) {
      setError("This page was opened without a Webflow connection request.");
      return;
    }
    void completeWebflowConnect({ data: { state, code } })
      .then((value) => {
        window.history.replaceState(null, "", window.location.pathname);
        setResult(value);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Webflow connection failed."));
  }, [search]);

  const choose = async (siteId: string) => {
    if (!result) return;
    setBusy(siteId);
    try {
      await selectWebflowSite({
        data: { workspaceId: result.workspaceId, connectionId: result.connectionId, siteId },
      });
      window.location.replace(back);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That Webflow site could not be linked.");
      setBusy(null);
    }
  };

  const back = result
    ? inWorkspace(
        result.workspaceId,
        result.returnPath ?? workspacePath(result.workspaceId, "", { tab: "overview" }),
      )
    : "/projects";
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
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Webflow
            </p>
            <h1 className="text-base font-semibold">
              {error
                ? "Couldn't connect Webflow"
                : result
                  ? "Webflow connected"
                  : "Connecting Webflow"}
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
            <Button asChild>
              <a href={back}>Return to Mellox</a>
            </Button>
          </div>
        )}
        {result && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-border/70 px-3 py-2.5">
              <p className="text-sm font-semibold">{result.accountEmail}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Choose the site Mellox should use for GEO and SEO analysis.
              </p>
            </div>
            <ul className="space-y-2">
              {result.sites.map((site) => (
                <li
                  key={site.id}
                  className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{site.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {site.domain ?? site.id}
                    </p>
                  </div>
                  <Button disabled={busy !== null} onClick={() => void choose(site.id)}>
                    {busy === site.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <CheckCircle className="size-3.5" />
                    )}
                    Select
                  </Button>
                </li>
              ))}
            </ul>
            {result.sites.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No sites were returned by Webflow. Check the account permissions and try
                reconnecting.
              </p>
            )}
            <Button variant="ghost" onClick={() => window.location.replace(back)}>
              Skip for now
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

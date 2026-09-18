"use client";

// GoogleConnectCallback — where Google returns after the user allows Mellox to
// read Google Analytics / Search Console. It completes the connection with the
// signed-in user's session (the single-use state proves this user started it
// and names the workspace), then returns to Analytics in that workspace to
// choose a property and site.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, GoogleIcon, Loader2 } from "@/components/icons";
import { completeGoogleConnect } from "@/lib/google-analytics.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { inWorkspace, workspacePath, WORKSPACES_HOME } from "@/lib/workspace/paths";

type View =
  | { kind: "working" }
  | { kind: "connected"; email: string; analytics: boolean; searchConsole: boolean; next: string }
  | { kind: "cancelled" }
  | { kind: "error"; message: string }
  | { kind: "signin"; loginHref: string };

const RETURN_DELAY_MS = 2200;

export function GoogleConnectCallback() {
  const search = useSearchParams();
  const [view, setView] = useState<View>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // The code and state are single-use: never submit twice (Strict Mode runs effects twice in dev).
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    const error = search.get("error");
    const clearParams = () => window.history.replaceState(null, "", window.location.pathname);

    if (error) {
      clearParams();
      setView(
        error === "access_denied"
          ? { kind: "cancelled" }
          : {
              kind: "error",
              message: "Google didn't finish connecting. Try again from Analytics.",
            },
      );
      return;
    }
    if (!state || !code) {
      setView({
        kind: "error",
        message: "This page was opened without a Mellox connection request. Start from Analytics.",
      });
      return;
    }
    const loginNext = `${window.location.pathname}${window.location.search}`;
    void (async () => {
      try {
        const result = await completeGoogleConnect({ data: { state, code } });
        clearParams();
        const next = result.returnPath
          ? inWorkspace(result.workspaceId, result.returnPath)
          : workspacePath(result.workspaceId, "", { tab: "website" });
        setView({
          kind: "connected",
          email: result.email,
          analytics: result.scopes.analytics,
          searchConsole: result.scopes.searchConsole,
          next,
        });
      } catch (e) {
        if (e instanceof ServerFnError && e.status === 401) {
          setView({ kind: "signin", loginHref: `/login?next=${encodeURIComponent(loginNext)}` });
          return;
        }
        clearParams();
        setView({
          kind: "error",
          message: e instanceof Error ? e.message : "The Google connection couldn't be completed.",
        });
      }
    })();
  }, [search]);

  useEffect(() => {
    if (view.kind !== "connected") return;
    const t = window.setTimeout(() => window.location.replace(view.next), RETURN_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
            <GoogleIcon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Analytics
            </p>
            <h1 className="truncate text-base font-semibold">
              {view.kind === "connected"
                ? "Google connected"
                : view.kind === "error"
                  ? "Couldn't connect Google"
                  : view.kind === "cancelled"
                    ? "Nothing was connected"
                    : "Connecting Google"}
            </h1>
          </div>
        </div>

        {view.kind === "working" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Finishing up…
          </p>
        )}

        {view.kind === "connected" && (
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-border/70 px-3 py-2.5">
              <p className="truncate text-sm font-semibold">{view.email}</p>
              <ul className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                <li className="flex items-center gap-1.5">
                  <CheckCircle
                    className={view.analytics ? "size-3.5 text-success" : "size-3.5 opacity-30"}
                    aria-hidden
                  />
                  Google Analytics 4 {view.analytics ? "" : "(not allowed)"}
                </li>
                <li className="flex items-center gap-1.5">
                  <CheckCircle
                    className={view.searchConsole ? "size-3.5 text-success" : "size-3.5 opacity-30"}
                    aria-hidden
                  />
                  Google Search Console {view.searchConsole ? "" : "(not allowed)"}
                </li>
              </ul>
            </div>
            <p className="text-sm text-muted-foreground">
              Next, pick your website in Analytics. Taking you back…
            </p>
            <Button asChild className="w-full">
              <Link href={view.next}>Back to Analytics</Link>
            </Button>
          </div>
        )}

        {(view.kind === "cancelled" || view.kind === "error") && (
          <div className="mt-6 space-y-4">
            {view.kind === "error" ? (
              <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{view.message}</span>
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                You can connect Google any time from Analytics.
              </p>
            )}
            <Button asChild variant="outline" className="w-full">
              <Link href={WORKSPACES_HOME}>Back to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "signin" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in with the account that started the connection and it will finish on its own.
            </p>
            <Button asChild className="w-full">
              <Link href={view.loginHref}>Sign in to Mellox</Link>
            </Button>
          </div>
        )}
      </section>
    </main>
  );
}

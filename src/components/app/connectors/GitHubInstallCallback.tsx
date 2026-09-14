"use client";

// GitHubInstallCallback — where the GitHub App install (or reconfigure) flow
// returns. It completes the connection with the signed-in user's session (the
// single-use state proves this user started it), tells every open Mellox tab
// over a BroadcastChannel, and closes the popup.
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Github, Loader2 } from "@/components/icons";
import { broadcastConnector, completeGithubInstall } from "@/lib/connectors.functions";
import { ServerFnError } from "@/lib/rpc-client";

type View =
  | { kind: "working" }
  | { kind: "connected"; account: string }
  | { kind: "requested" }
  | { kind: "error"; message: string }
  | { kind: "signin"; loginHref: string };

const BACK_HREF = "/app";

export function GitHubInstallCallback() {
  const params = useSearchParams();
  const [view, setView] = useState<View>({ kind: "working" });
  const started = useRef(false);

  useEffect(() => {
    // The state is single-use: never submit it twice (Strict Mode runs effects twice in dev).
    if (started.current) return;
    started.current = true;

    const installationId = params.get("installation_id") ?? "";
    const setupAction = params.get("setup_action");
    const state = params.get("state") ?? "";
    const code = params.get("code");

    if (setupAction === "request") {
      // An organization member asked an owner to approve the install.
      setView({ kind: "requested" });
      return;
    }
    if (!installationId || !state) {
      setView({
        kind: "error",
        message: state
          ? "GitHub didn't return an installation. Try connecting again."
          : "This page was opened without a Mellox connection request. Start the connection from Mellox → Integrations.",
      });
      return;
    }

    // Kept so a signed-out installer can sign in and land back here; the state stays bound to the user who started it.
    const returnPath = `${window.location.pathname}${window.location.search}`;

    completeGithubInstall({
      data: {
        state,
        installationId,
        setupAction: setupAction === "install" || setupAction === "update" ? setupAction : null,
        code,
      },
    })
      .then(({ connection }) => {
        broadcastConnector({ type: "connected", provider: "github", connectionId: connection.id });
        setView({ kind: "connected", account: connection.accountLogin });
      })
      .catch((e: unknown) => {
        if (e instanceof ServerFnError && e.status === 401) {
          setView({ kind: "signin", loginHref: `/login?next=${encodeURIComponent(returnPath)}` });
          return;
        }
        const message =
          e instanceof Error ? e.message : "The GitHub connection couldn't be completed.";
        broadcastConnector({ type: "error", provider: "github", message });
        setView({ kind: "error", message });
      });
    // Drop sensitive query parameters from the address bar and history.
    window.history.replaceState(null, "", window.location.pathname);
  }, [params]);

  useEffect(() => {
    if (view.kind !== "connected") return;
    // Only script-opened windows can close themselves; otherwise the link stays.
    const t = window.setTimeout(() => window.close(), 1600);
    return () => window.clearTimeout(t);
  }, [view.kind]);

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary">
            <Github className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Integrations
            </p>
            <h1 className="truncate text-base font-semibold">Connect GitHub</h1>
          </div>
        </div>

        {view.kind === "working" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Verifying the installation with GitHub…
          </p>
        )}

        {view.kind === "connected" && (
          <div className="mt-6 space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle className="size-4" aria-hidden />
              GitHub account {view.account} is connected.
            </p>
            <p className="text-sm text-muted-foreground">
              Back in Mellox, choose the repository behind your website. You can close this window.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={BACK_HREF}>Back to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "requested" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm font-medium">Install request sent</p>
            <p className="text-sm text-muted-foreground">
              An owner of that GitHub organization needs to approve the Mellox AI app. Once they do,
              return to Mellox → Integrations and connect again.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={BACK_HREF}>Back to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "signin" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm font-medium">Sign in to finish connecting</p>
            <p className="text-sm text-muted-foreground">
              GitHub sent you back, but this browser isn't signed in to Mellox. Sign in with the
              account that started the connection and it will complete automatically.
            </p>
            <Button asChild className="w-full">
              <Link href={view.loginHref}>Sign in to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "error" && (
          <div className="mt-6 space-y-4">
            <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{view.message}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => window.close()}>
                Close
              </Button>
              <Button asChild className="flex-1">
                <Link href={BACK_HREF}>Back to Mellox</Link>
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

"use client";

// GitHubInstallCallback — where the GitHub App install (or reconfigure) flow
// returns. It completes the connection with the signed-in user's session (the
// single-use state proves this user started it), tells every open Mellox tab
// over a BroadcastChannel, and closes the popup — or, when the install ran in
// this tab, returns to Settings → Connections.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Github, Loader2 } from "@/components/icons";
import { broadcastConnector, completeGithubInstall } from "@/lib/connectors.functions";
import { ServerFnError } from "@/lib/rpc-client";

type View =
  | { kind: "working" }
  | { kind: "connected"; account: string; returning: boolean }
  | { kind: "requested" }
  | { kind: "updated" }
  | { kind: "error"; message: string; retryable: boolean }
  | { kind: "signin"; loginHref: string };

const SETTINGS_HREF = "/app?settings=connections";
const POPUP_NAME = "mellox-github-install";

type Params = {
  installationId: string;
  setupAction: "install" | "update" | null;
  state: string;
  code: string | null;
};

/** Opened by Mellox as a popup (the opener link may be cut by GitHub's isolation headers). */
function isPopup(): boolean {
  try {
    return Boolean(window.opener) || window.name === POPUP_NAME;
  } catch {
    return false;
  }
}

export function GitHubInstallCallback() {
  const search = useSearchParams();
  const [view, setView] = useState<View>({ kind: "working" });
  const started = useRef(false);
  const params = useRef<Params | null>(null);
  const returnPath = useRef("");

  const complete = useCallback(async () => {
    const p = params.current;
    if (!p) return;
    setView({ kind: "working" });
    try {
      const { connection } = await completeGithubInstall({
        data: {
          state: p.state,
          installationId: p.installationId,
          setupAction: p.setupAction,
          code: p.code,
        },
      });
      // Drop the single-use parameters from the address bar and history.
      window.history.replaceState(null, "", window.location.pathname);
      broadcastConnector({ type: "connected", provider: "github", connectionId: connection.id });
      setView({ kind: "connected", account: connection.accountLogin, returning: !isPopup() });
    } catch (e: unknown) {
      if (e instanceof ServerFnError && e.status === 401) {
        setView({
          kind: "signin",
          loginHref: `/login?next=${encodeURIComponent(returnPath.current)}`,
        });
        return;
      }
      const message =
        e instanceof Error ? e.message : "The GitHub connection couldn't be completed.";
      // Invalid, expired, foreign or used links can't succeed on retry; anything else can.
      const retryable =
        !(e instanceof ServerFnError && (e.status === 400 || e.status === 403)) ||
        /authorization code|try again/i.test(message);
      broadcastConnector({ type: "error", provider: "github", message });
      setView({ kind: "error", message, retryable });
    }
  }, []);

  useEffect(() => {
    // Never submit twice from one page load (Strict Mode runs effects twice in dev).
    if (started.current) return;
    started.current = true;

    const installationId = search.get("installation_id") ?? "";
    const setupAction = search.get("setup_action");
    const state = search.get("state") ?? "";
    const code = search.get("code");

    if (setupAction === "request") {
      // An organization member asked an owner to approve the install.
      window.history.replaceState(null, "", window.location.pathname);
      setView({ kind: "requested" });
      return;
    }
    if (setupAction === "update" && !state) {
      // Reconfigured from GitHub's own settings page — no Mellox request to complete.
      window.history.replaceState(null, "", window.location.pathname);
      setView({ kind: "updated" });
      return;
    }
    if (!installationId || !state) {
      setView({
        kind: "error",
        retryable: false,
        message: state
          ? "GitHub didn't return an installation. Try connecting again."
          : "This page was opened without a Mellox connection request. Start the connection from Settings → Connections.",
      });
      return;
    }

    // Kept so a signed-out installer can sign in and land back here; the state stays bound to the user who started it.
    returnPath.current = `${window.location.pathname}${window.location.search}`;
    params.current = {
      installationId,
      setupAction: setupAction === "install" || setupAction === "update" ? setupAction : null,
      state,
      code,
    };
    void complete();
  }, [search, complete]);

  useEffect(() => {
    if (view.kind !== "connected") return;
    const t = window.setTimeout(() => {
      if (view.returning) window.location.replace(`${SETTINGS_HREF}&github=connected`);
      else window.close();
    }, 1400);
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
            Verifying the installation with GitHub and saving the connection…
          </p>
        )}

        {view.kind === "connected" && (
          <div className="mt-6 space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle className="size-4" aria-hidden />
              GitHub account {view.account} is connected.
            </p>
            <p className="text-sm text-muted-foreground">
              {view.returning
                ? "Taking you back to Settings → Connections to choose the repository behind your website…"
                : "Back in Mellox, choose the repository behind your website. You can close this window."}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={`${SETTINGS_HREF}&github=connected`}>Open Settings → Connections</Link>
            </Button>
          </div>
        )}

        {view.kind === "requested" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm font-medium">Install request sent</p>
            <p className="text-sm text-muted-foreground">
              An owner of that GitHub organization needs to approve the Mellox AI app. Once they do,
              return to Settings → Connections and connect again.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={SETTINGS_HREF}>Back to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "updated" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm font-medium">GitHub saved your changes</p>
            <p className="text-sm text-muted-foreground">
              In Settings → Connections, press Verify on the GitHub connection to pick up the new
              repository access.
            </p>
            <Button asChild className="w-full">
              <Link href={SETTINGS_HREF}>Open Settings → Connections</Link>
            </Button>
          </div>
        )}

        {view.kind === "signin" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm font-medium">Sign in to finish connecting</p>
            <p className="text-sm text-muted-foreground">
              GitHub sent you back, but this browser isn&apos;t signed in to Mellox here. Sign in
              with the account that started the connection and it will complete automatically.
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
              {view.retryable && params.current ? (
                <Button className="flex-1" onClick={() => void complete()}>
                  Try again
                </Button>
              ) : null}
              <Button asChild variant="outline" className="flex-1">
                <Link href={SETTINGS_HREF}>Back to Settings</Link>
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

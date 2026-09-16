"use client";

// GitHubInstallCallback — where GitHub returns after the user authorizes (or
// installs) the Mellox App. It completes the connection with the signed-in
// user's session (the single-use state proves this user started it), shows
// the result, and returns to the Mellox page the connection started from.
// "Connected" is shown only after the server has read the saved connection
// back through this user's own access.
import { inWorkspace, isWorkspaceId, workspacePath, WORKSPACES_HOME } from "@/lib/workspace/paths";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle, Github, Loader2 } from "@/components/icons";
import { completeGithubInstall, startGithubInstall } from "@/lib/connectors.functions";
import { rememberGithubConnected } from "@/lib/connectors/github-return";
import type { ConnectionView } from "@/lib/connectors/types";
import { ServerFnError } from "@/lib/rpc-client";

type View =
  | { kind: "working" }
  | { kind: "continuing"; step: "install" | "authorize" }
  | { kind: "connected"; connections: ConnectionView[]; next: string }
  | { kind: "cancelled" }
  | { kind: "requested" }
  | { kind: "updated" }
  | { kind: "error"; message: string }
  | { kind: "signin"; loginHref: string };

const connectionsHref = (ws: string | null) =>
  ws && isWorkspaceId(ws) ? workspacePath(ws, "", { settings: "connections" }) : WORKSPACES_HOME;
const geoHref = (ws: string | null) =>
  ws && isWorkspaceId(ws) ? workspacePath(ws, "", { geo: "findings" }) : WORKSPACES_HOME;
const CONNECTIONS_HREF = WORKSPACES_HOME;
/** Authorize ↔ install hand-offs in one attempt; stops a misconfigured App from looping. */
const HOPS_KEY = "mellox:github-connect-hops";
const RETURN_DELAY_MS = 2500;

function safePath(path: string | null | undefined): string {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : CONNECTIONS_HREF;
}

function withConnectedFlag(path: string): string {
  const url = new URL(safePath(path), window.location.origin);
  url.searchParams.set("github", "connected");
  return `${url.pathname}${url.search}${url.hash}`;
}

function hops(next?: number): number {
  try {
    if (next === undefined) return Number(sessionStorage.getItem(HOPS_KEY) ?? "0") || 0;
    if (next === 0) sessionStorage.removeItem(HOPS_KEY);
    else sessionStorage.setItem(HOPS_KEY, String(next));
    return next;
  } catch {
    return 0;
  }
}

export function GitHubInstallCallback() {
  const search = useSearchParams();
  const [view, setView] = useState<View>({ kind: "working" });
  const [retrying, setRetrying] = useState(false);
  const started = useRef(false);
  const workspaceId = useRef<string | null>(null);

  useEffect(() => {
    // The code and state are single-use: never submit twice (Strict Mode runs effects twice in dev).
    if (started.current) return;
    started.current = true;

    const installationId = search.get("installation_id");
    const setupAction = search.get("setup_action");
    const state = search.get("state") ?? "";
    const code = search.get("code");
    const error = search.get("error");
    // Drop the single-use parameters from the address bar and history.
    const clearParams = () => window.history.replaceState(null, "", window.location.pathname);

    if (error) {
      clearParams();
      hops(0);
      setView(
        error === "access_denied"
          ? { kind: "cancelled" }
          : { kind: "error", message: "GitHub didn't complete the authorization. Try again." },
      );
      return;
    }
    if (setupAction === "request") {
      // An organization member asked an owner to approve the install.
      clearParams();
      setView({ kind: "requested" });
      return;
    }
    if (setupAction === "update" && !state) {
      // Reconfigured from GitHub's own settings page — no Mellox request to complete.
      clearParams();
      setView({ kind: "updated" });
      return;
    }
    if (!state || (!installationId && !code)) {
      setView({
        kind: "error",
        message: state
          ? "GitHub didn't return an installation or an authorization. Try connecting again."
          : "This page was opened without a Mellox connection request. Start the connection from Settings → Connections.",
      });
      return;
    }

    // Kept so a signed-out user can sign in and land back here; the state stays bound to the user who started it.
    const loginNext = `${window.location.pathname}${window.location.search}`;
    void (async () => {
      try {
        const result = await completeGithubInstall({
          data: {
            state,
            installationId,
            setupAction: setupAction === "install" || setupAction === "update" ? setupAction : null,
            code,
          },
        });
        workspaceId.current = result.workspaceId;
        clearParams();
        if (result.status === "continue") {
          const count = hops();
          if (count >= 3) {
            hops(0);
            setView({
              kind: "error",
              message:
                result.step === "install"
                  ? "GitHub didn't send you back after installing the Mellox AI app. Check that the app is installed on your account, then connect again."
                  : "GitHub kept asking for authorization without confirming it. Try connecting again.",
            });
            return;
          }
          hops(count + 1);
          setView({ kind: "continuing", step: result.step });
          window.setTimeout(() => window.location.assign(result.url), 900);
          return;
        }
        hops(0);
        rememberGithubConnected({
          workspaceId: result.workspaceId,
          accounts: result.connections.map((c) => c.accountLogin),
        });
        setView({
          kind: "connected",
          connections: result.connections,
          // Land in the workspace GitHub was connected to, not whichever was open last.
          next: withConnectedFlag(
            result.returnPath
              ? inWorkspace(result.workspaceId, result.returnPath)
              : connectionsHref(result.workspaceId),
          ),
        });
      } catch (e: unknown) {
        if (e instanceof ServerFnError && e.status === 401) {
          setView({ kind: "signin", loginHref: `/login?next=${encodeURIComponent(loginNext)}` });
          return;
        }
        clearParams();
        hops(0);
        setView({
          kind: "error",
          message: e instanceof Error ? e.message : "The GitHub connection couldn't be completed.",
        });
      }
    })();
  }, [search]);

  // Return to where the connection started once the success has been seen.
  useEffect(() => {
    if (view.kind !== "connected") return;
    const t = window.setTimeout(() => window.location.replace(view.next), RETURN_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [view]);

  const retry = useCallback(async () => {
    const ws = workspaceId.current;
    if (!ws) {
      window.location.assign(CONNECTIONS_HREF);
      return;
    }
    setRetrying(true);
    try {
      const { url } = await startGithubInstall({
        data: {
          workspaceId: ws,
          returnOrigin: window.location.origin,
          returnPath: connectionsHref(ws),
        },
      });
      window.location.assign(url);
    } catch (e) {
      setRetrying(false);
      setView({
        kind: "error",
        message: e instanceof Error ? e.message : "Couldn't start the GitHub connection.",
      });
    }
  }, []);

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
            <h1 className="truncate text-base font-semibold">
              {view.kind === "connected"
                ? "GitHub connected successfully"
                : view.kind === "error"
                  ? "GitHub connection failed"
                  : view.kind === "cancelled"
                    ? "GitHub authorization was cancelled"
                    : "Connect GitHub"}
            </h1>
          </div>
        </div>

        {view.kind === "working" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Completing GitHub connection…
          </p>
        )}

        {view.kind === "continuing" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {view.step === "install"
              ? "Your GitHub account doesn't have the Mellox AI app yet — taking you to GitHub to install it…"
              : "Taking you to GitHub to confirm this installation…"}
          </p>
        )}

        {view.kind === "connected" && (
          <div className="mt-6 space-y-4">
            <ul className="space-y-2">
              {view.connections.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5"
                >
                  {c.accountAvatarUrl ? (
                    <img
                      src={c.accountAvatarUrl}
                      alt=""
                      className="size-8 rounded-full ring-1 ring-border"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="grid size-8 place-items-center rounded-full bg-secondary text-sm font-semibold">
                      {c.accountLogin.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{c.accountLogin}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.accountType ?? "Account"} ·{" "}
                      {c.repositorySelection === "all"
                        ? "all repositories"
                        : "selected repositories"}
                    </p>
                  </div>
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success ring-1 ring-success/25">
                    <CheckCircle className="size-3" aria-hidden />
                    {c.status === "active" ? "Installation active" : c.status}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Next, choose the repository that builds your website. Taking you back to Mellox…
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <Link href={withConnectedFlag(connectionsHref(workspaceId.current))}>
                  Continue to Connections
                </Link>
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href={withConnectedFlag(geoHref(workspaceId.current))}>Continue to GEO</Link>
              </Button>
            </div>
          </div>
        )}

        {view.kind === "cancelled" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Nothing was connected. You can try again whenever you&apos;re ready.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1" loading={retrying} onClick={() => void retry()}>
                Try again
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href={connectionsHref(workspaceId.current)}>Return to Connections</Link>
              </Button>
            </div>
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
              <Link href={connectionsHref(workspaceId.current)}>Return to Connections</Link>
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
              <Link href={connectionsHref(workspaceId.current)}>Open Settings → Connections</Link>
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
              <Button className="flex-1" loading={retrying} onClick={() => void retry()}>
                Try again
              </Button>
              <Button asChild variant="outline" className="flex-1">
                <Link href={connectionsHref(workspaceId.current)}>Return to Connections</Link>
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

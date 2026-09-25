"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, CheckCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { completeWordPressOAuth, selectWordPressSite } from "@/lib/wordpress.functions";
import { ServerFnError } from "@/lib/rpc-client";
import { inWorkspace, WORKSPACES_HOME, workspacePath } from "@/lib/workspace/paths";

type Site = {
  id: string;
  siteId: string | null;
  name: string;
  url: string;
  selected: boolean;
  status: string;
};

type View =
  | { kind: "working" }
  | {
      kind: "sites";
      workspaceId: string;
      connectionId: string;
      accountName: string;
      next: string;
      sites: Site[];
    }
  | { kind: "cancelled"; message: string }
  | { kind: "signin"; loginHref: string }
  | { kind: "error"; message: string }
  | { kind: "empty"; message: string; next: string };

export function WordPressConnectCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [view, setView] = useState<View>({ kind: "working" });
  const [busySiteId, setBusySiteId] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    const error = search.get("error");
    const errorDescription = search.get("error_description") ?? "";
    const clear = () => window.history.replaceState(null, "", window.location.pathname);

    if (error) {
      clear();
      setView({
        kind: "cancelled",
        message:
          error === "access_denied"
            ? "WordPress.com authorization was cancelled."
            : errorDescription
              ? "WordPress.com did not finish the connection. Please try again."
              : "WordPress.com did not finish the connection. Please try again.",
      });
      return;
    }

    if (!state || !code) {
      setView({
        kind: "error",
        message: "This page was opened without a valid WordPress.com connection request.",
      });
      return;
    }

    const loginNext = `${window.location.pathname}${window.location.search}`;

    void (async () => {
      try {
        const result = await completeWordPressOAuth({ data: { state, code } });
        clear();
        const next = result.returnPath
          ? inWorkspace(result.workspaceId, result.returnPath)
          : workspacePath(result.workspaceId, "", { tab: "website" });

        if (!result.connection || !result.connection.sites?.length) {
          setView({
            kind: "empty",
            message: "No WordPress.com sites were available for this account.",
            next,
          });
          return;
        }

        setView({
          kind: "sites",
          workspaceId: result.workspaceId,
          connectionId: result.connection.connectionId,
          accountName: result.connection.accountName || "WordPress.com account",
          next,
          sites: result.connection.sites,
        });
      } catch (e) {
        if (e instanceof ServerFnError && e.status === 401) {
          setView({ kind: "signin", loginHref: `/login?next=${encodeURIComponent(loginNext)}` });
          return;
        }
        clear();
        const rawMessage =
          e instanceof Error ? e.message : "WordPress.com could not finish connecting.";
        setView({
          kind: "error",
          message: /expired|invalid|link/i.test(rawMessage)
            ? "This WordPress.com connection request is no longer valid. Please try again."
            : /denied|oauth|authorization|token/i.test(rawMessage)
              ? "WordPress.com could not finish the connection. Please try again."
              : "WordPress.com could not finish connecting. Please try again.",
        });
      }
    })();
  }, [search]);

  const select = async (siteId: string) => {
    if (view.kind !== "sites") return;
    setBusySiteId(siteId);
    try {
      await selectWordPressSite({
        data: { workspaceId: view.workspaceId, connectionId: view.connectionId, siteId },
      });
      window.location.replace(view.next);
    } catch (e) {
      setBusySiteId(null);
      setView({
        kind: "error",
        message: e instanceof Error ? e.message : "That WordPress.com site could not be selected.",
      });
    }
  };

  const backHref = view.kind === "sites" ? view.next : WORKSPACES_HOME;

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-[#21759b] text-white">
            <CheckCircle className="size-5" />
          </span>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              WordPress.com
            </p>
            <h1 className="text-base font-semibold">
              {view.kind === "sites"
                ? "Choose a WordPress site"
                : view.kind === "cancelled"
                  ? "Connection cancelled"
                  : view.kind === "empty"
                    ? "No sites available"
                    : view.kind === "signin"
                      ? "Sign in to continue"
                      : view.kind === "error"
                        ? "Could not connect WordPress"
                        : "Connecting WordPress"}
            </h1>
          </div>
        </div>

        {view.kind === "working" && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Connecting to WordPress.com...
          </p>
        )}

        {view.kind === "sites" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              {view.accountName} is connected. Choose the WordPress.com site Mellox should use.
            </p>
            <ul className="space-y-2">
              {view.sites.map((site) => (
                <li
                  key={site.id}
                  className="flex items-center gap-3 rounded-xl border border-border/60 px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{site.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{site.url}</p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                      {site.status}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => void select(site.siteId ?? site.id)}
                    disabled={busySiteId !== null || site.selected}
                  >
                    {busySiteId === (site.siteId ?? site.id) ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : site.selected ? (
                      "Selected"
                    ) : (
                      "Select site"
                    )}
                  </Button>
                </li>
              ))}
            </ul>
            <Button asChild variant="ghost" className="w-full">
              <Link href={view.next}>Skip for now</Link>
            </Button>
          </div>
        )}

        {view.kind === "empty" && (
          <div className="mt-6 space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              {view.message}
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={view.next}>Back to Mellox</Link>
            </Button>
          </div>
        )}

        {view.kind === "signin" && (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Sign in to Mellox to finish connecting WordPress.com.
            </p>
            <Button asChild className="w-full">
              <Link href={view.loginHref}>Sign in</Link>
            </Button>
          </div>
        )}

        {(view.kind === "error" || view.kind === "cancelled") && (
          <div className="mt-6 space-y-4">
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
              {view.message}
            </p>
            <div className="flex gap-2">
              <Button asChild variant="outline" className="flex-1">
                <Link href={backHref}>Back to Mellox</Link>
              </Button>
              <Button className="flex-1" onClick={() => window.location.assign(WORKSPACES_HOME)}>
                <RefreshCw className="mr-2 size-3.5" /> Try again
              </Button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

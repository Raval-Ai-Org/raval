"use client";

// SocialConnectCallback — the page a social platform's consent flow returns to
// (via SocialAPI.ai). It finishes the connection server-side (one-time state,
// tenant check), lets the user pick Facebook Pages when the platform asks, then
// tells every open Mellox tab over a BroadcastChannel and closes the popup.
import { isWorkspaceId, workspacePath, WORKSPACES_HOME } from "@/lib/workspace/paths";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand/BrandLogo";
import { CheckCircle, Loader2 } from "@/components/icons";
import { DISTRIBUTION_PLATFORMS, isDistributionPlatform } from "@/lib/distribution-platforms";
import {
  broadcastSocialConnect,
  completeSocialConnect,
  readPendingConnect,
  selectSocialPending,
} from "@/lib/sdr.functions";
import type { PendingPage } from "@/lib/socialapi/handlers";

type View =
  | { kind: "working" }
  | { kind: "connected" }
  | { kind: "select"; connectionId: string; pages: PendingPage[]; lostAccess: string[] }
  | { kind: "error"; message: string };

const MAX_PAGES = 5;
/** Back to the workspace the connection was started from — never a guessed one. */
function backHref(workspaceId: string | null): string {
  return workspaceId && isWorkspaceId(workspaceId)
    ? workspacePath(workspaceId, "", { tab: "social" })
    : WORKSPACES_HOME;
}

function resolveWorkspaceId(): string | null {
  return readPendingConnect()?.workspaceId ?? null;
}

function finish(platform: string | null) {
  try {
    localStorage.removeItem("social:connect:pending");
  } catch {
    /* ignore */
  }
  broadcastSocialConnect({ type: "connected", platform: platform ?? undefined });
}

export function SocialConnectCallback() {
  const params = useSearchParams();
  const [view, setView] = useState<View>({ kind: "working" });
  const [selected, setSelected] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const started = useRef(false);

  const platform = params.get("platform");
  const meta = isDistributionPlatform(platform) ? DISTRIBUTION_PLATFORMS[platform] : null;
  const label = meta?.label ?? "Your account";

  useEffect(() => {
    // The state is single-use: never submit it twice (React Strict Mode runs
    // effects twice in development).
    if (started.current) return;
    started.current = true;

    const state = params.get("state") ?? "";
    const status = params.get("status") ?? "";
    const workspaceId = resolveWorkspaceId();
    if (!state || !status) {
      setView({ kind: "error", message: "This page was opened without a connection result." });
      return;
    }
    if (!workspaceId) {
      setView({
        kind: "error",
        message: "Open Mellox in this browser and start the connection again.",
      });
      return;
    }

    completeSocialConnect(workspaceId, {
      state,
      status,
      accountId: params.get("account_id"),
      connectionId: params.get("connection_id"),
      error: params.get("error"),
      errorDescription: params.get("error_description"),
    })
      .then((result) => {
        if (result.status === "connected") {
          finish(platform);
          setView({ kind: "connected" });
        } else if (result.status === "selection_required") {
          const assignable = result.pages.filter((p) => p.assignable);
          setSelected(assignable.slice(0, 1).map((p) => p.id));
          setView({
            kind: "select",
            connectionId: result.connectionId,
            pages: result.pages,
            lostAccess: result.lostAccess,
          });
        } else {
          broadcastSocialConnect({ type: "error", platform: platform ?? undefined });
          setView({ kind: "error", message: result.message });
        }
      })
      .catch((e: unknown) =>
        setView({
          kind: "error",
          message: e instanceof Error ? e.message : "The connection couldn't be completed.",
        }),
      );
  }, [params, platform]);

  useEffect(() => {
    if (view.kind !== "connected") return;
    // Only script-opened windows can close themselves; otherwise the link stays.
    const t = window.setTimeout(() => window.close(), 1500);
    return () => window.clearTimeout(t);
  }, [view.kind]);

  const submitSelection = async () => {
    if (view.kind !== "select" || !selected.length) return;
    const workspaceId = resolveWorkspaceId();
    if (!workspaceId) return;
    setSubmitting(true);
    try {
      await selectSocialPending(workspaceId, view.connectionId, selected);
      finish(platform);
      setView({ kind: "connected" });
    } catch (e) {
      setView({
        kind: "error",
        message: e instanceof Error ? e.message : "Those Pages couldn't be connected.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PAGES ? cur : [...cur, id],
    );

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4 text-foreground">
      <section
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm"
        aria-live="polite"
      >
        <div className="flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary"
            style={{ color: meta?.tint }}
          >
            {meta ? <BrandLogo name={meta.logo} brand size={20} /> : null}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Connect account
            </p>
            <h1 className="truncate text-base font-semibold">{label}</h1>
          </div>
        </div>

        {view.kind === "working" ? (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Finishing the connection…
          </p>
        ) : null}

        {view.kind === "connected" ? (
          <div className="mt-6 space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle className="size-4" aria-hidden />
              {label} is connected.
            </p>
            <p className="text-sm text-muted-foreground">
              You can close this window and return to Mellox.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href={backHref(resolveWorkspaceId())}>Back to Mellox</Link>
            </Button>
          </div>
        ) : null}

        {view.kind === "select" ? (
          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted-foreground">
              Choose the Pages Mellox can publish to (up to {MAX_PAGES}).
            </p>
            {view.lostAccess.length ? (
              <p className="rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-xs text-warning">
                This authorization removed access to {view.lostAccess.join(", ")}. To keep them,
                reconnect Facebook and leave those Pages checked.
              </p>
            ) : null}
            {view.pages.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
                This Facebook login doesn&apos;t manage any Pages.
              </p>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {view.pages.map((page) => (
                  <li key={page.id}>
                    <label
                      className={`flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm ${page.assignable ? "cursor-pointer hover:bg-secondary/60" : "opacity-60"}`}
                    >
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={selected.includes(page.id)}
                        disabled={
                          !page.assignable ||
                          (!selected.includes(page.id) && selected.length >= MAX_PAGES)
                        }
                        onChange={() => toggle(page.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{page.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {page.assignable
                            ? (page.category ?? "Facebook Page")
                            : "Already connected elsewhere"}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <Button
              className="w-full"
              disabled={!selected.length}
              loading={submitting}
              onClick={() => void submitSelection()}
            >
              Connect {selected.length === 1 ? "1 Page" : `${selected.length} Pages`}
            </Button>
          </div>
        ) : null}

        {view.kind === "error" ? (
          <div className="mt-6 space-y-4">
            <p className="flex items-start gap-2 text-sm text-danger">
              <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{view.message}</span>
            </p>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => window.close()}>
                Close
              </Button>
              <Button asChild className="flex-1">
                <Link href={backHref(resolveWorkspaceId())}>Back to Mellox</Link>
              </Button>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}

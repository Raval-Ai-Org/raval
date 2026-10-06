"use client";
import { useCallback, useEffect, useState } from "react";
import {
  useOptionalWorkspaceId,
  useOptionalWorkspaceRole,
} from "@/components/workspace/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import {
  getCanvaConnection,
  removeCanvaConnection,
  startCanvaConnect,
} from "@/lib/canva.functions";
import { emitAppEvent } from "@/lib/app-events";

type Status = Awaited<ReturnType<typeof getCanvaConnection>>;

export function CanvaConnection() {
  const workspaceId = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setStatus(await getCanvaConnection({ data: { workspaceId } }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Canva connection.");
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  if (!workspaceId) return null;
  const connected = status?.status === "active";
  return (
    <section className="rounded-2xl border border-border bg-card p-4" aria-label="Canva connection">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">Canva</h3>
          <p className="text-sm text-muted-foreground">
            {connected
              ? `Connected${status.accountName && status.accountName !== "Canva" ? ` as ${status.accountName}` : ""}`
              : status?.status === "error"
                ? "Connection needs attention · reconnect to edit"
                : "Not connected"}
          </p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            Connect Canva to edit Mellox-generated designs and import your finished versions back
            into Mellox.
          </p>
        </div>
        {role !== "viewer" && (
          <div className="flex gap-2">
            {connected ? (
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await removeCanvaConnection({ data: { workspaceId } });
                    await refresh();
                    emitAppEvent("connections:changed");
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "Could not disconnect Canva.",
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Disconnect
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={busy || !status?.configured}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const { url } = await startCanvaConnect({
                      data: {
                        workspaceId,
                        returnPath: window.location.pathname + window.location.search,
                      },
                    });
                    window.location.assign(url);
                  } catch (cause) {
                    setError(
                      cause instanceof Error ? cause.message : "Could not start Canva connection.",
                    );
                    setBusy(false);
                  }
                }}
              >
                {busy ? "Connecting…" : status?.status === "error" ? "Reconnect" : "Connect Canva"}
              </Button>
            )}
          </div>
        )}
      </div>
      {!status?.configured && status && (
        <p className="mt-2 text-xs text-muted-foreground">Canva needs server configuration.</p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

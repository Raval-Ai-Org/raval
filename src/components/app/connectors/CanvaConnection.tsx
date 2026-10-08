"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/toast";
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
import { CanvaMark } from "@/components/brand/CanvaMark";
import { ConnectionCard } from "./ConnectionCard";
import { DisconnectDialog } from "./DisconnectDialog";
import { useConnectWindow } from "./useConnectWindow";

type Status = Awaited<ReturnType<typeof getCanvaConnection>>;

export function CanvaConnection() {
  const workspaceId = useOptionalWorkspaceId();
  const role = useOptionalWorkspaceRole();
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setStatus(await getCanvaConnection({ data: { workspaceId } }));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load Canva connection.");
    }
  }, [workspaceId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Canva signs in in its own window; this hears when it closes.
  const canvaWindow = useConnectWindow("canva", workspaceId, (result) => {
    if (result?.status === "connected") {
      toast.success("Canva connected");
      emitAppEvent("connections:changed");
    }
    setBusy(false);
    void refresh();
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("canva") !== "connected") return;
    toast.success("Canva connected");
    url.searchParams.delete("canva");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  if (!workspaceId) return null;
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  const connected = status?.status === "active";
  const needsAttention = status?.status === "error";
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      await canvaWindow.connect(
        async () =>
          (
            await startCanvaConnect({
              data: { workspaceId, returnPath: `${window.location.pathname}?settings=accounts` },
            })
          ).url,
      );
      setBusy(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start Canva connection.");
      setBusy(false);
    }
  };
  const disconnect = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeCanvaConnection({ data: { workspaceId } });
      await refresh();
      emitAppEvent("connections:changed");
      toast.success("Canva disconnected");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not disconnect Canva.");
    } finally {
      setBusy(false);
      setConfirmOpen(false);
    }
  };
  return (
    <>
      <ConnectionCard
        label="Canva connection"
        logo={<CanvaMark />}
        name="Canva"
        description="Edit your images and carousels in Canva"
        status={
          status
            ? connected
              ? { tone: "connected", text: "Connected" }
              : needsAttention
                ? { tone: "attention", text: "Reconnect needed" }
                : { tone: "off", text: "Not connected" }
            : error
              ? { tone: "off", text: "Unavailable" }
              : null
        }
        actions={
          canEdit &&
          status &&
          (connected ? (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmOpen(true)}>
              Disconnect
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !status.configured}
                onClick={() => void connect()}
              >
                {busy
                  ? "Opening…"
                  : canvaWindow.waiting
                    ? "Waiting for Canva…"
                    : needsAttention
                      ? "Reconnect"
                      : "Connect"}
              </Button>
              {needsAttention && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setConfirmOpen(true)}
                >
                  Disconnect
                </Button>
              )}
            </>
          ))
        }
        note={
          status && !status.configured
            ? (status.configurationMessage ?? "Canva is not set up on this server yet.")
            : undefined
        }
        error={error}
      />
      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        name="Canva"
        description="Your designs in Canva and your versions in Mellox stay where they are."
        busy={busy}
        onConfirm={() => void disconnect()}
      />
    </>
  );
}

"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  useOptionalWorkspaceId,
  useOptionalWorkspaceRole,
} from "@/components/workspace/WorkspaceProvider";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  getCanvaConnection,
  removeCanvaConnection,
  startCanvaConnect,
} from "@/lib/canva.functions";
import { emitAppEvent } from "@/lib/app-events";
import { ConnectionCard } from "./ConnectionCard";

type Status = Awaited<ReturnType<typeof getCanvaConnection>>;

function CanvaMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" className="size-7 shrink-0">
      <defs>
        <linearGradient
          id="canva-mark"
          x1="4"
          y1="28"
          x2="28"
          y2="4"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7D2AE7" />
          <stop offset="1" stopColor="#00C4CC" />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14" fill="url(#canva-mark)" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth="2.6"
        strokeLinecap="round"
        d="M20.6 12.4a5.4 5.4 0 1 0 0 7.2"
      />
    </svg>
  );
}

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
      const { url } = await startCanvaConnect({
        data: { workspaceId, returnPath: `${window.location.pathname}?settings=accounts` },
      });
      window.location.assign(url);
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
        description="Open any Mellox image or carousel in Canva, edit it, then bring your version back."
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
        detail={
          connected
            ? "Use “Edit with Canva” on an image in Studio or your Library."
            : needsAttention
              ? "Canva stopped accepting this connection. Connect again to keep editing."
              : undefined
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
                disabled={busy || !status.configured}
                onClick={() => void connect()}
              >
                {busy ? "Opening Canva…" : needsAttention ? "Reconnect" : "Connect Canva"}
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
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Canva?</AlertDialogTitle>
            <AlertDialogDescription>
              You won’t be able to edit in Canva or bring versions back until you connect again.
              Designs already in Canva and versions already in Mellox stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void disconnect()}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { completeCanvaConnect } from "@/lib/canva.functions";
import { emitAppEvent } from "@/lib/app-events";
import { safeCanvaReturn } from "@/lib/canva-return";
import {
  announceConnectResult,
  finishConnectWindow,
  isConnectWindow,
} from "@/lib/connectors/connect-window";
import { ServerFnError } from "@/lib/rpc-client";

export function CanvaCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [detail, setDetail] = useState("");
  const [inWindow, setInWindow] = useState(false);
  useEffect(() => setInWindow(isConnectWindow()), []);
  useEffect(() => {
    if (failure && inWindow) announceConnectResult({ provider: "canva", status: "error" });
  }, [failure, inWindow]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    const reason = search.get("error");
    if (reason || !state || !code) {
      setFailure(
        reason === "access_denied"
          ? "You closed Canva before allowing access, so nothing was connected."
          : reason === "invalid_scope"
            ? "Canva refused the access Mellox asked for. The Canva integration needs every permission Mellox uses switched on."
            : "Canva didn’t finish connecting. Please try again.",
      );
      // What Canva itself said, so whoever runs this server can fix it.
      const said = [reason, search.get("error_description")].filter(Boolean).join(": ");
      setDetail(
        said
          ? `Canva said: ${said.slice(0, 240)}`
          : !code
            ? "Canva came back without a sign-in code."
            : "",
      );
      return;
    }
    void completeCanvaConnect({ data: { state, code } })
      .then((result) => {
        emitAppEvent("connections:changed");
        if (
          finishConnectWindow({
            provider: "canva",
            status: "connected",
            workspaceId: result.workspaceId,
          })
        )
          return;
        const target = new URL(
          safeCanvaReturn(result.workspaceId, result.returnPath),
          window.location.origin,
        );
        // Settings shows the confirmation; elsewhere the edit button is right there.
        if (target.searchParams.has("settings")) target.searchParams.set("canva", "connected");
        window.location.replace(`${target.pathname}${target.search}${target.hash}`);
      })
      .catch((e) => {
        if (e instanceof ServerFnError && e.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
        setFailure(e instanceof Error ? e.message : "Could not connect Canva.");
      });
  }, [search]);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <div
        className="w-full max-w-sm rounded-3xl border border-border bg-card p-7 text-center text-foreground"
        role="status"
      >
        {failure ? (
          <>
            <h1 className="text-[17px] font-semibold">Canva isn’t connected</h1>
            <p className="mt-2 text-[13px] leading-5 text-muted-foreground">{failure}</p>
            {detail && (
              <p className="mt-3 break-words rounded-xl bg-muted px-3 py-2 text-[12px] text-muted-foreground">
                {detail}
              </p>
            )}
            <Button
              className="mt-5"
              onClick={() => (inWindow ? window.close() : window.location.replace("/projects"))}
            >
              {inWindow ? "Close" : "Back to Mellox"}
            </Button>
          </>
        ) : (
          <>
            <span
              aria-hidden
              className="mx-auto block size-6 animate-spin rounded-full border-2 border-border border-t-primary"
            />
            <p className="mt-4 text-[14px] font-medium">Connecting Canva…</p>
          </>
        )}
      </div>
    </main>
  );
}

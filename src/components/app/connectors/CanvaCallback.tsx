"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { completeCanvaConnect } from "@/lib/canva.functions";
import { emitAppEvent } from "@/lib/app-events";
import { safeCanvaReturn } from "@/lib/canva-return";
import { ServerFnError } from "@/lib/rpc-client";

export function CanvaCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    if (search.get("error") || !state || !code) {
      setFailure(
        search.get("error") === "access_denied"
          ? "You closed Canva before allowing access, so nothing was connected."
          : "Canva didn’t finish connecting. Please try again.",
      );
      return;
    }
    void completeCanvaConnect({ data: { state, code } })
      .then((result) => {
        emitAppEvent("connections:changed");
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
            <Button className="mt-5" onClick={() => window.location.replace("/projects")}>
              Back to Mellox
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

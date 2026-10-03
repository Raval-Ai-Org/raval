"use client";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { completeCanvaConnect } from "@/lib/canva.functions";
import { emitAppEvent } from "@/lib/app-events";
import { safeCanvaReturn } from "@/lib/canva-return";
import { ServerFnError } from "@/lib/rpc-client";

export function CanvaCallback() {
  const search = useSearchParams();
  const started = useRef(false);
  const [message, setMessage] = useState("Connecting Canva…");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const state = search.get("state") ?? "";
    const code = search.get("code") ?? "";
    if (search.get("error") || !state || !code) {
      setMessage("Canva connection was cancelled or incomplete.");
      return;
    }
    void completeCanvaConnect({ data: { state, code } })
      .then((result) => {
        window.history.replaceState(null, "", window.location.pathname);
        emitAppEvent("connections:changed");
        window.location.replace(safeCanvaReturn(result.workspaceId, result.returnPath));
      })
      .catch((e) => {
        if (e instanceof ServerFnError && e.status === 401) {
          const next = `${window.location.pathname}${window.location.search}`;
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        window.history.replaceState(null, "", window.location.pathname);
        setMessage(e instanceof Error ? e.message : "Could not connect Canva.");
      });
  }, [search]);
  return (
    <main className="grid min-h-dvh place-items-center bg-background p-4">
      <section
        className="rounded-2xl border border-border bg-card p-6 text-foreground"
        role="status"
      >
        {message}
      </section>
    </main>
  );
}

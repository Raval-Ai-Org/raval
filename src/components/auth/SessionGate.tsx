"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";

/**
 * Client-side replacement for the router's `beforeLoad` session check on the
 * authenticated routes. The Supabase session lives in localStorage, so the gate
 * has to run in the browser; nothing renders until the check resolves, which
 * keeps signed-out visitors from seeing a flash of workspace UI.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        const next = `${window.location.pathname}${window.location.search}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    // A visible, accessible loading state instead of a blank screen while the
    // session is checked (it lives in localStorage, so the check is client-side).
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-background"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <span className="text-[13px] text-muted-foreground">Loading your workspace…</span>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

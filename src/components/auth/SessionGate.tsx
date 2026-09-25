"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ErrorState } from "@/components/ui/empty-state";
import { PageLoader } from "@/components/ui/page-loader";
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
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (cancelled) return;
        if (sessionError) throw sessionError;
        if (!data.session) {
          const next = `${window.location.pathname}${window.location.search}`;
          router.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setError(null);
        setReady(true);
      } catch (cause) {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not check your sign-in session.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  if (error) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background p-6">
        <ErrorState
          title="Couldn't verify your sign-in"
          description="Your workspace data cannot load until your session is available."
          detail={error}
          onRetry={() => {
            setError(null);
            setAttempt((current) => current + 1);
          }}
        />
      </div>
    );
  }

  if (!ready) {
    // A visible, accessible loading state instead of a blank screen while the
    // session is checked (it lives in localStorage, so the check is client-side).
    return <PageLoader label="Loading your workspace…" />;
  }
  return <>{children}</>;
}

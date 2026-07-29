import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { consumeStoredNextPath, friendlyAuthError } from "@/lib/auth";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/auth/callback")({
  component: AuthCallbackPage,
});

type CallbackState =
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

function decodeOAuthError(raw: string | null) {
  if (!raw) return null;
  let out = raw.replace(/\+/g, " ");
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(out);
      if (decoded === out) break;
      out = decoded;
    } catch {
      break;
    }
  }
  return out;
}

function AuthCallbackPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const [state, setState] = useState<CallbackState>({
    status: "loading",
    message: "Finishing secure sign-in…",
  });

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return consumeStoredNextPath("/app");
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function finishSignIn() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const queryParams = new URLSearchParams(window.location.search);
      const error = decodeOAuthError(hashParams.get("error_description") || queryParams.get("error_description") || hashParams.get("error") || queryParams.get("error"));

      if (error) {
        setState({
          status: "error",
          message: friendlyAuthError(new Error(error)),
        });
        return;
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          setState({ status: "error", message: friendlyAuthError(sessionError) });
          return;
        }
      } else if (queryParams.get("code")) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (exchangeError) {
          setState({ status: "error", message: friendlyAuthError(exchangeError) });
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setState({ status: "error", message: "Sign-in did not return a valid session. Please try again." });
        return;
      }

      try {
        await ensureWorkspace();
      } catch (workspaceError) {
        setState({ status: "error", message: friendlyAuthError(workspaceError) });
        return;
      }

      if (cancelled) return;
      window.history.replaceState({}, document.title, "/auth/callback");
      setState({ status: "success", message: "Sign-in complete. Redirecting…" });
      setTimeout(() => navigate({ to: nextPath as any, replace: true }), 350);
    }

    finishSignIn();
    return () => { cancelled = true; };
  }, [navigate, nextPath]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card/80 p-8 text-center shadow-card backdrop-blur-xl">
        <div className="mb-6 flex justify-center"><Logo height={32} /></div>
        {state.status === "loading" ? (
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
        ) : state.status === "success" ? (
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
        ) : (
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-500" />
        )}
        <h1 className="mt-5 text-xl font-semibold">{state.status === "error" ? "Sign-in needs setup" : "Signing you in"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.message}</p>
        {state.status === "error" && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild><Link to="/login">Back to login</Link></Button>
            <Button variant="outline" asChild><Link to="/signup">Create account</Link></Button>
          </div>
        )}
      </div>
    </div>
  );
}

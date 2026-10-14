"use client";

import { Link, useNavigate } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { useEffect, useRef, useState } from "react";
import { Loader2, AlertTriangle, CheckCircle2 } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { consumeStoredNextPath, friendlyAuthError } from "@/lib/auth";
import { exchangeAuthCode } from "@/lib/auth-code";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

type CallbackState =
  | { status: "loading"; message: string }
  | { status: "success"; message: string }
  | { status: "error"; message: string };

type CallbackResult = { nextPath: string } | { message: string };

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

  const attempt = useRef<Promise<CallbackResult> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let redirect: ReturnType<typeof setTimeout> | undefined;

    async function finishSignIn(callbackUrl: URL, nextPath: string): Promise<CallbackResult> {
      const hashParams = new URLSearchParams(callbackUrl.hash.replace(/^#/, ""));
      const queryParams = callbackUrl.searchParams;
      const error = decodeOAuthError(
        hashParams.get("error_description") ||
          queryParams.get("error_description") ||
          hashParams.get("error") ||
          queryParams.get("error"),
      );

      if (error) {
        return { message: friendlyAuthError(new Error(error)) };
      }

      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (sessionError) {
          return { message: friendlyAuthError(sessionError) };
        }
      } else {
        const authCode = queryParams.get("code");
        if (!authCode) {
          return { message: "Sign-in did not return an authorization code. Please try again." };
        }

        // exchangeCodeForSession expects the raw one-time authorization code,
        // not the callback URL. Supabase uses the PKCE verifier it stored when
        // signInWithOAuth started the flow to exchange this code for a session.
        const { error: exchangeError } = await exchangeAuthCode(callbackUrl);
        if (exchangeError) {
          return { message: friendlyAuthError(exchangeError) };
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) return { message: friendlyAuthError(sessionError) };
      if (!data.session) {
        return { message: "Sign-in did not return a valid session. Please try again." };
      }

      await ensureWorkspace();
      return { nextPath };
    }

    if (!attempt.current) {
      const callbackUrl = new URL(window.location.href);
      const nextPath = consumeStoredNextPath("/projects");
      // Capture once, then scrub before loading Supabase. React may replay the
      // effect, but the one-time code and stored destination are consumed once.
      window.history.replaceState(window.history.state, document.title, "/auth/callback");
      attempt.current = finishSignIn(callbackUrl, nextPath).catch((error) => ({
        message: friendlyAuthError(error),
      }));
    }
    void attempt.current.then((result) => {
      if (cancelled) return;
      if ("message" in result) {
        setState({ status: "error", message: result.message });
        return;
      }
      setState({ status: "success", message: "Sign-in complete. Redirecting…" });
      redirect = setTimeout(() => navigate({ to: result.nextPath, replace: true }), 350);
    });
    return () => {
      cancelled = true;
      clearTimeout(redirect);
    };
  }, [ensureWorkspace, navigate]);

  return (
    <div className="grid min-h-dvh place-items-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border/70 bg-card/80 p-8 text-center shadow-card backdrop-blur-xl">
        <div className="mb-6 flex justify-center">
          <Logo height={32} />
        </div>
        {state.status === "loading" ? (
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
        ) : state.status === "success" ? (
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-500" />
        ) : (
          <AlertTriangle className="mx-auto h-9 w-9 text-amber-500" />
        )}
        <h1 className="mt-5 text-xl font-semibold">
          {state.status === "error" ? "Sign-in needs setup" : "Signing you in"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{state.message}</p>
        {state.status === "error" && (
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
            <Button asChild>
              <Link to="/login">Back to login</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/signup">Create account</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AuthCallbackPage;

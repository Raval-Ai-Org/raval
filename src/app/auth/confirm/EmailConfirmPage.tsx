"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { consumeStoredNextPath } from "@/lib/auth";
import {
  captureEmailConfirmation,
  emailConfirmationDestination,
  saveEmailConfirmation,
  type PendingEmailConfirmation,
} from "@/lib/email-confirmation";
import { ResendConfirmation } from "@/components/auth/ResendConfirmation";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { useServerFn } from "@/lib/use-server-fn";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

export default function EmailConfirmPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const captured = useRef(false);
  const verified = useRef(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const pending = useRef<PendingEmailConfirmation | null>(null);
  const [confirmation, setConfirmation] = useState<PendingEmailConfirmation["confirmation"] | null>(
    null,
  );
  const [status, setStatus] = useState<"ready" | "loading" | "success" | "error">("ready");
  const [message, setMessage] = useState("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    function capture() {
      // Templates use fragments so credentials never reach server logs/referrers.
      // Also accept older query links, but scrub both before any auth request.
      const capturedLink = captureEmailConfirmation(window.location.hash || window.location.search);
      pending.current = capturedLink;
      verified.current = false;
      const parsed = capturedLink?.confirmation ?? null;
      window.history.replaceState(window.history.state, document.title, "/auth/confirm");
      setConfirmation(parsed);
      setStatus("ready");
      setMessage(
        parsed
          ? ""
          : "This email link is missing or invalid. Reopen the complete link from your email, or request a new confirmation below.",
      );
    }
    if (!captured.current) {
      captured.current = true;
      capture();
    }
    // Mobile browsers may reuse this document when the newest email is opened.
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);

  async function confirm() {
    if (!confirmation || busy.current) return;
    busy.current = true;
    setStatus("loading");
    setMessage("");
    const activeLink = pending.current;
    try {
      if (pending.current?.verifiedUserId) {
        const { data } = await supabase.auth.getSession();
        if (pending.current !== activeLink) return;
        verified.current = data.session?.user.id === pending.current.verifiedUserId;
      }
      if (!verified.current) {
        const { data, error } = await supabase.auth.verifyOtp(confirmation);
        if (pending.current !== activeLink) return;
        if (error) throw error;
        if (!data.session && confirmation.type !== "email_change") {
          throw new Error("Verification did not establish a session");
        }
        // The token is single-use. A later workspace failure must retry setup,
        // rather than submit the already-consumed token to Supabase again.
        verified.current = true;
        if (data.session && pending.current) {
          pending.current.verifiedUserId = data.session.user.id;
          saveEmailConfirmation(pending.current);
        }
        if (confirmation.type === "email_change" && !data.session) {
          saveEmailConfirmation(null);
          setStatus("success");
          setMessage(
            "Email change confirmation received. If confirmation is required at both addresses, open the other email too. Then sign in with your confirmed address.",
          );
          return;
        }
      }
      if (!mounted.current) return;
      // Email changes can be confirmed without issuing a fresh session.
      const { data, error } = await supabase.auth.getSession();
      if (pending.current !== activeLink) return;
      if (error) throw error;
      if (!mounted.current) return;
      if (!data.session) {
        throw new Error("No session was established");
      }
      if (confirmation.type !== "recovery") {
        await ensureWorkspace();
      }
      if (pending.current !== activeLink) return;
      if (!mounted.current) return;
      setStatus("success");
      saveEmailConfirmation(null);
      const destination =
        confirmation.type === "recovery"
          ? emailConfirmationDestination(confirmation.type)
          : consumeStoredNextPath(emailConfirmationDestination(confirmation.type));
      navigate({ to: destination, replace: true });
    } catch (error) {
      if (mounted.current && pending.current === activeLink) {
        setStatus("error");
        setMessage(
          verified.current
            ? "Your email is confirmed, but we couldn't finish opening your account. Please retry."
            : error && typeof error === "object" && "code" in error && error.code === "otp_expired"
              ? "This link has expired or was already used. Sign in if you already confirmed, or request a new email below. Use the newest email after resending."
              : "This link could not be confirmed. Check your connection or request a new email and try again.",
        );
      }
    } finally {
      busy.current = false;
    }
  }

  const action =
    confirmation?.type === "recovery"
      ? "Continue to password reset"
      : confirmation?.type === "invite"
        ? "Accept invitation"
        : confirmation?.type === "magiclink"
          ? "Sign in to Mellox AI"
          : confirmation?.type === "email_change"
            ? "Confirm email change"
            : "Confirm email";

  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-8 text-foreground">
      <section className="w-full max-w-md rounded-3xl border border-border bg-card p-7 text-center shadow-card sm:p-9">
        <div className="mb-8 flex justify-center">
          <Logo height={32} />
        </div>
        <h1 className="text-2xl font-semibold">
          {status === "success" ? "Confirmed" : "One more step"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {message ||
            (confirmation
              ? "Select the button below to finish securely."
              : "Checking your email link…")}
        </p>
        {confirmation && status !== "success" ? (
          <Button
            className="mt-7 w-full"
            size="xl"
            onClick={confirm}
            loading={status === "loading"}
          >
            {action}
          </Button>
        ) : !confirmation ? (
          <Button asChild variant="outline" className="mt-7 w-full">
            <Link to="/login">Back to login</Link>
          </Button>
        ) : null}
        {status === "success" && confirmation?.type === "email_change" ? (
          <Button asChild className="mt-7 w-full">
            <Link to="/login">Continue to login</Link>
          </Button>
        ) : null}
        {(!confirmation ||
          (status === "error" &&
            !verified.current &&
            ["email", "signup", "recovery"].includes(confirmation.type))) && (
          <div className="mt-6">
            <ResendConfirmation recovery={confirmation?.type === "recovery"} />
          </div>
        )}
        {status === "error" && confirmation && (
          <p className="mt-5 text-sm">
            <Link to="/login" className="underline">
              Back to login
            </Link>
          </p>
        )}
      </section>
    </main>
  );
}

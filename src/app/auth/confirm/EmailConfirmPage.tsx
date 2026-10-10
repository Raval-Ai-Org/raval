"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { consumeStoredNextPath, friendlyAuthError } from "@/lib/auth";
import { emailConfirmationDestination, readEmailConfirmation } from "@/lib/email-confirmation";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { useServerFn } from "@/lib/use-server-fn";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";

type Confirmation = NonNullable<ReturnType<typeof readEmailConfirmation>>;

export default function EmailConfirmPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const captured = useRef(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [status, setStatus] = useState<"ready" | "loading" | "success" | "error">("ready");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (captured.current) return;
    captured.current = true;
    // The hash never reaches the server or a referrer. Remove it before loading
    // the Supabase client or making any network request in this page.
    const parsed = readEmailConfirmation(window.location.hash);
    window.history.replaceState({}, document.title, "/auth/confirm");
    setConfirmation(parsed);
    if (!parsed)
      setMessage(
        "This link is invalid or has already been opened. Request a new email to continue.",
      );
  }, []);

  async function confirm() {
    if (!confirmation || status === "loading") return;
    setStatus("loading");
    const { data, error } = await supabase.auth.verifyOtp(confirmation);
    if (error) {
      setStatus("error");
      setMessage(
        "This link could not be confirmed. It may have expired or already been used. Request a new email and try again.",
      );
      return;
    }
    // Email changes can be confirmed without issuing a fresh session. Never
    // call workspace RPCs or enter a protected route in that case.
    const session = data.session ?? (await supabase.auth.getSession()).data.session;
    if (!session) {
      navigate({ to: "/login", replace: true });
      return;
    }
    if (confirmation.type !== "recovery") {
      try {
        await ensureWorkspace();
      } catch (workspaceError) {
        setStatus("error");
        setMessage(friendlyAuthError(workspaceError));
        return;
      }
    }
    setStatus("success");
    const destination =
      confirmation.type === "recovery"
        ? emailConfirmationDestination(confirmation.type)
        : consumeStoredNextPath(emailConfirmationDestination(confirmation.type));
    navigate({ to: destination as "/projects", replace: true });
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
      </section>
    </main>
  );
}

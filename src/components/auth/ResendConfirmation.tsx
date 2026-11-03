"use client";

import { useRef, useState, type FormEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, passwordResetUrl } from "@/lib/auth";
import { AuthCaptcha, useAuthCaptcha } from "./AuthCaptcha";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ResendConfirmation({ recovery = false }: { recovery?: boolean }) {
  const captcha = useAuthCaptcha();
  const busy = useRef(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [retryAt, setRetryAt] = useState(0);

  async function resend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    if (Date.now() < retryAt) {
      setMessage("Please wait a minute before requesting another email.");
      return;
    }
    busy.current = true;
    setLoading(true);
    try {
      const captchaToken = captcha.take();
      const { error } = recovery
        ? await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: passwordResetUrl(),
            ...(captchaToken ? { captchaToken } : {}),
          })
        : await supabase.auth.resend({
            type: "signup",
            email: email.trim(),
            options: {
              // Do not overwrite a saved invitation/destination when resending.
              emailRedirectTo: new URL("/auth/callback", window.location.origin).toString(),
              ...(captchaToken ? { captchaToken } : {}),
            },
          });
      if (error) throw error;
      setRetryAt(Date.now() + 60_000);
      setMessage(
        recovery
          ? "If this address has an account, a password reset email has been sent. Use the newest email."
          : "If this address needs confirmation, a new email has been sent. Check spam too, and use the newest email. Already confirmed? Return to login.",
      );
    } catch (error) {
      setMessage(friendlyAuthError(error));
    } finally {
      busy.current = false;
      setLoading(false);
      captcha.reset();
    }
  }

  return (
    <form onSubmit={resend} className="space-y-3 text-left">
      <AuthCaptcha state={captcha} />
      <label htmlFor="confirmation-email" className="text-sm">
        {recovery ? "Send a new password reset email" : "Resend signup confirmation"}
      </label>
      <Input
        id="confirmation-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="Your email address"
      />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        loading={loading}
        disabled={loading || !captcha.ready}
      >
        {recovery ? "Send password reset email" : "Resend confirmation email"}
      </Button>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
    </form>
  );
}

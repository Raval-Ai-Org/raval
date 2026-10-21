"use client";

import { Spinner } from "@/components/icons";
import { Link, useNavigate } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowRight } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, authNextPath, authCallbackUrl } from "@/lib/auth";
import { siteFromNextPath } from "@/lib/redirects";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AuthCaptcha, useAuthCaptcha } from "@/components/auth/AuthCaptcha";
import { AuthShell, authRow } from "@/components/auth/AuthShell";
import { toast } from "@/lib/toast";

function SignupPage() {
  const captcha = useAuthCaptcha();
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/projects";
    return authNextPath(window.location.search);
  }, []);
  // Set after mount: the server render has no query to read.
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => setSite(siteFromNextPath(nextPath)), [nextPath]);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: nextPath, replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, nextPath]);

  const onEmailSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailLoading(true);
    try {
      const captchaToken = captcha.take();
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim(), full_name: name.trim() },
          emailRedirectTo: authCallbackUrl(nextPath),
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) {
        toast.error("Could not create account", { description: friendlyAuthError(error) });
        return;
      }
      if (data.session) {
        await ensureWorkspace();
        navigate({ to: nextPath, replace: true });
        return;
      }
      setConfirmationSent(true);
      toast.success("Check your email to confirm");
    } catch (error) {
      toast.error("Could not create account", { description: friendlyAuthError(error) });
    } finally {
      setEmailLoading(false);
      captcha.reset();
    }
  };

  const onResendConfirmation = async () => {
    const address = email.trim();
    if (!address) {
      toast.error("Enter your email first");
      return;
    }
    setResendLoading(true);
    try {
      const captchaToken = captcha.take();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: address,
        options: {
          emailRedirectTo: authCallbackUrl(nextPath),
          ...(captchaToken ? { captchaToken } : {}),
        },
      });
      if (error) {
        toast.error("Could not resend confirmation", { description: friendlyAuthError(error) });
        return;
      }
      setConfirmationSent(true);
      toast.success("Confirmation email sent again", {
        description: "Check your inbox and spam folder.",
      });
    } catch (error) {
      toast.error("Could not resend confirmation", { description: friendlyAuthError(error) });
    } finally {
      setResendLoading(false);
      captcha.reset();
    }
  };

  const onGoogleSuccess = async () => {
    await ensureWorkspace();
    navigate({ to: nextPath, replace: true });
  };

  return (
    <AuthShell
      title="Create account"
      subtitle={site ? `Then we'll scan ${site}.` : undefined}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            // Keep where the person was going (e.g. an invite link) when they
            // switch between sign in and sign up.
            onClick={(e) => {
              if (nextPath === "/projects") return;
              e.preventDefault();
              navigate({ to: "/login", search: { next: nextPath } });
            }}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <AuthCaptcha state={captcha} />
      <motion.div variants={authRow}>
        <GoogleSignInButton
          disabled={emailLoading || googleLoading || resendLoading || !captcha.ready}
          captcha={captcha}
          onBusyChange={setGoogleLoading}
          onSuccess={onGoogleSuccess}
          onError={(error) =>
            toast.error("Google sign-in failed", { description: friendlyAuthError(error) })
          }
        />
      </motion.div>

      <motion.div
        variants={authRow}
        className="flex items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-muted-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </motion.div>

      <form onSubmit={onEmailSignup} className="space-y-3">
        <motion.div variants={authRow}>
          <FieldShell>
            <Input
              id="name"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="h-12 border-0 bg-transparent px-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </FieldShell>
        </motion.div>

        <motion.div variants={authRow}>
          <FieldShell>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="h-12 border-0 bg-transparent px-4 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </FieldShell>
        </motion.div>

        <motion.div variants={authRow}>
          <FieldShell>
            <Input
              id="password"
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (8+ characters)"
              className="h-12 border-0 bg-transparent px-4 pr-11 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </FieldShell>
        </motion.div>

        <motion.div variants={authRow}>
          <Button
            type="submit"
            size="xl"
            className="group relative w-full overflow-hidden rounded-2xl text-base font-semibold transition-transform hover:-translate-y-[1px]"
            loading={emailLoading}
            disabled={emailLoading || googleLoading || resendLoading || !captcha.ready}
          >
            <span className="relative z-10 inline-flex items-center gap-2">
              Create account
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Button>
        </motion.div>
      </form>

      {confirmationSent && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-primary-border bg-primary/5 p-4 text-center"
        >
          <p className="text-sm font-medium text-foreground">
            Check your email to finish signing up.
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Open the confirmation link in the same browser. Check spam or promotions if it does not
            arrive shortly.
          </p>
          <button
            type="button"
            onClick={onResendConfirmation}
            disabled={resendLoading || emailLoading || googleLoading || !captcha.ready}
            className="mt-3 text-xs font-semibold text-primary underline-offset-4 hover:underline disabled:opacity-50"
          >
            {resendLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner className="h-3 w-3 animate-spin" aria-hidden /> Sending…
              </span>
            ) : (
              "Resend confirmation email"
            )}
          </button>
        </motion.div>
      )}
    </AuthShell>
  );
}

function FieldShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative rounded-2xl border border-input bg-background/60 transition-all focus-within:border-primary/60 focus-within:bg-background focus-within:shadow-[0_0_0_4px_hsl(var(--primary)/0.10)] hover:border-foreground/25">
      {children}
    </div>
  );
}

export default SignupPage;

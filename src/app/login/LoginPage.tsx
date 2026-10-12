"use client";

import { Spinner } from "@/components/icons";
import { Link, useNavigate } from "@/lib/navigation";
import { useServerFn } from "@/lib/use-server-fn";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowRight } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError, authNextPath, passwordResetUrl } from "@/lib/auth";
import { siteFromNextPath } from "@/lib/redirects";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AuthShell, authRow } from "@/components/auth/AuthShell";
import { toast } from "@/lib/toast";

function LoginPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/projects";
    return authNextPath(window.location.search);
  }, []);
  // Set after mount: the server render has no query to read.
  const [site, setSite] = useState<string | null>(null);
  useEffect(() => setSite(siteFromNextPath(nextPath)), [nextPath]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: nextPath, replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, nextPath]);

  const onEmailSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        toast.error("Sign in failed", { description: friendlyAuthError(error) });
        return;
      }
      await ensureWorkspace();
      navigate({ to: nextPath, replace: true });
    } catch (error) {
      toast.error("Sign in failed", { description: friendlyAuthError(error) });
    } finally {
      setEmailLoading(false);
    }
  };

  const onGoogleSuccess = async () => {
    await ensureWorkspace();
    navigate({ to: nextPath, replace: true });
  };

  const onResetPassword = async () => {
    if (!email.trim()) {
      toast.error("Enter your email first");
      return;
    }
    setResetLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: passwordResetUrl(),
    });
    setResetLoading(false);
    if (error) toast.error("Could not send reset link", { description: friendlyAuthError(error) });
    else toast.success("Reset link sent");
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle={site ? `Sign in and we'll scan ${site}.` : undefined}
      footer={
        <p className="text-center text-sm text-muted-foreground">
          New here?{" "}
          <Link
            to="/signup"
            // Keep where the person was going (e.g. an invite link) when they
            // switch between sign in and sign up.
            onClick={(e) => {
              if (nextPath === "/projects") return;
              e.preventDefault();
              navigate({ to: "/signup", search: { next: nextPath } });
            }}
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Create an account
          </Link>
        </p>
      }
    >
      <motion.div variants={authRow}>
        <GoogleSignInButton
          disabled={emailLoading || googleLoading}
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

      <form onSubmit={onEmailSignIn} className="space-y-3">
        <motion.div variants={authRow}>
          <FieldShell>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email address"
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
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
              placeholder="Password"
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

        <motion.div variants={authRow} className="flex justify-end">
          <button
            type="button"
            onClick={onResetPassword}
            disabled={resetLoading || emailLoading || googleLoading}
            className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:pointer-events-none disabled:opacity-50"
          >
            {resetLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Spinner className="h-3 w-3 animate-spin" aria-hidden /> Sending…
              </span>
            ) : (
              "Forgot password?"
            )}
          </button>
        </motion.div>

        <motion.div variants={authRow}>
          <Button
            type="submit"
            size="xl"
            className="group relative w-full overflow-hidden rounded-2xl text-base font-semibold transition-transform hover:-translate-y-[1px]"
            loading={emailLoading}
            disabled={emailLoading || googleLoading}
          >
            <span className="relative z-10 inline-flex items-center gap-2">
              Sign in
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Button>
        </motion.div>
      </form>
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

export default LoginPage;

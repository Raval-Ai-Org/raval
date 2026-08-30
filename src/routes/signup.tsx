import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Eye, EyeOff, ArrowRight } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { signInWithGoogle, friendlyAuthError, safeNextPath, authCallbackUrl } from "@/lib/auth";
import { ensureAuthWorkspace } from "@/lib/workspaces.functions";
import { BASE_URL } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AuthShell, authRow } from "@/components/auth/AuthShell";
import { toast } from "sonner";

export const Route = createFileRoute("/signup")({
  head: () => ({
    meta: [
      { title: "Create account · Raval AI" },
      {
        name: "description",
        content:
          "Create your Raval AI workspace — the Marketing Intelligence Layer for brands and agencies.",
      },
      { property: "og:title", content: "Create account · Raval AI" },
      {
        property: "og:description",
        content:
          "Start your Raval AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
      },
      { property: "og:url", content: `${BASE_URL}/signup` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Create account · Raval AI" },
      {
        name: "twitter:description",
        content:
          "Start your Raval AI workspace and get visible inside LLMs with AEO/GEO, Brand DNA and multi-client operations.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
    links: [{ rel: "canonical", href: `${BASE_URL}/signup` }],
  }),
  component: SignupPage,
});

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.49h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.63z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"
      />
    </svg>
  );
}

function SignupPage() {
  const navigate = useNavigate();
  const ensureWorkspace = useServerFn(ensureAuthWorkspace);
  const nextPath = useMemo(() => {
    if (typeof window === "undefined") return "/app";
    return safeNextPath(new URLSearchParams(window.location.search).get("next"), "/app");
  }, []);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) navigate({ to: nextPath as any, replace: true });
    });
    return () => {
      cancelled = true;
    };
  }, [navigate, nextPath]);

  const onEmailSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setEmailLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { name: name.trim(), full_name: name.trim() },
          emailRedirectTo: authCallbackUrl(nextPath),
        },
      });
      if (error) {
        toast.error("Could not create account", { description: friendlyAuthError(error) });
        return;
      }
      if (data.session) {
        await ensureWorkspace();
        navigate({ to: nextPath as any, replace: true });
        return;
      }
      toast.success("Check your email to confirm");
    } catch (error) {
      toast.error("Could not create account", { description: friendlyAuthError(error) });
    } finally {
      setEmailLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const result = await signInWithGoogle(nextPath);
      if (!result.redirected) {
        await ensureWorkspace();
        navigate({ to: nextPath as any, replace: true });
      }
    } catch (error) {
      setGoogleLoading(false);
      toast.error("Google sign-up failed", { description: friendlyAuthError(error) });
    }
  };

  return (
    <AuthShell
      title="Create account"
      footer={
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <motion.div variants={authRow}>
        <Button
          type="button"
          variant="outline"
          size="xl"
          className="group relative w-full gap-3 overflow-hidden rounded-2xl border-border bg-card font-medium transition-all hover:-translate-y-[1px] hover:border-foreground/25"
          onClick={onGoogleSignIn}
          loading={googleLoading}
          disabled={emailLoading || googleLoading}
        >
          {!googleLoading && <GoogleMark />}
          <span>Continue with Google</span>
        </Button>
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
            disabled={emailLoading || googleLoading}
          >
            <span className="relative z-10 inline-flex items-center gap-2">
              Create account
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

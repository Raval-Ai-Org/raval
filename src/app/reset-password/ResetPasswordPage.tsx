"use client";

import { Link, useNavigate } from "@/lib/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound } from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { friendlyAuthError } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/brand/Logo";
import { pageHead } from "@/lib/seo";
import { toast } from "sonner";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function prepareRecoverySession() {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const queryParams = new URLSearchParams(window.location.search);
      const accessToken = hashParams.get("access_token");
      const refreshToken = hashParams.get("refresh_token");

      if (accessToken && refreshToken) {
        const { error } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (error) {
          toast.error("Reset link failed", { description: friendlyAuthError(error) });
          return;
        }
        window.history.replaceState({}, document.title, "/reset-password");
      } else if (queryParams.get("code")) {
        const { error } = await supabase.auth.exchangeCodeForSession(window.location.href);
        if (error) {
          toast.error("Reset link failed", { description: friendlyAuthError(error) });
          return;
        }
        window.history.replaceState({}, document.title, "/reset-password");
      }

      const { data } = await supabase.auth.getSession();
      if (!cancelled) setReady(Boolean(data.session));
    }

    prepareRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error("Could not update password", { description: friendlyAuthError(error) });
      return;
    }

    toast.success("Password updated", { description: "You can now continue to your workspace." });
    navigate({ to: "/projects", replace: true });
  };

  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-8 text-foreground">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,hsl(var(--brand-green)/0.18),transparent_34%),radial-gradient(circle_at_82%_24%,hsl(var(--brand-blue)/0.14),transparent_30%)]"
      />
      <section className="relative z-10 w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo height={32} />
        </div>
        <div className="rounded-3xl border border-border/70 bg-card/85 p-6 shadow-card backdrop-blur-xl sm:p-8">
          <div className="mb-7 text-center">
            <KeyRound className="mx-auto h-9 w-9 text-primary" />
            <h1 className="mt-4 text-3xl font-semibold">Set new password</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {ready
                ? "Choose a new password for your Mellox AI account."
                : "Open the reset link from your email to continue."}
            </p>
          </div>

          {ready ? (
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="password">New password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="At least 8 characters"
                    className="h-12 rounded-xl pr-12"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((value) => !value)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" size="xl" className="w-full rounded-xl" loading={loading}>
                Update password
              </Button>
            </form>
          ) : (
            <Button asChild variant="outline" size="xl" className="w-full rounded-xl">
              <Link to="/login">Back to login</Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

export default ResetPasswordPage;

"use client";

// MfaPanel — the second factor for the admin console. Used twice:
//   mode "gate"    the server wants a verified second factor before any admin
//                  route answers; sets one up first if the person has none.
//   mode "reauth"  a sensitive change wants a check from the last few minutes.
// It only talks to Supabase Auth (TOTP); the server decides what counts.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Shield } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { fieldClass } from "./parts";

type Enrollment = { factorId: string; qr: string; secret: string };

export function MfaPanel({
  mode,
  onVerified,
  className,
}: {
  mode: "gate" | "reauth";
  onVerified: () => void;
  className?: string;
}) {
  const [phase, setPhase] = useState<"loading" | "enroll" | "verify" | "error">("loading");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setMessage(null);
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      setMessage(error.message);
      setPhase("error");
      return;
    }
    const verified = data.totp[0];
    if (verified) {
      setFactorId(verified.id);
      setPhase("verify");
      return;
    }
    // A leftover, never-finished enrolment would block a new one.
    for (const stale of data.all.filter(
      (f) => f.factor_type === "totp" && f.status !== "verified",
    )) {
      await supabase.auth.mfa.unenroll({ factorId: stale.id });
    }
    const enrolled = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Mellox admin",
    });
    if (enrolled.error || !enrolled.data) {
      setMessage(enrolled.error?.message ?? "Could not start setup.");
      setPhase("error");
      return;
    }
    setEnrollment({
      factorId: enrolled.data.id,
      qr: enrolled.data.totp.qr_code,
      secret: enrolled.data.totp.secret,
    });
    setFactorId(enrolled.data.id);
    setPhase("enroll");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    setMessage(null);
    const result = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
    setBusy(false);
    if (result.error) {
      setCode("");
      setMessage(result.error.message || "That code didn't work. Try the newest one.");
      return;
    }
    onVerified();
  }

  return (
    <div className={cn("ds-tile mx-auto w-full max-w-sm space-y-4 p-6 text-center", className)}>
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-primary/15 text-primary">
        <Shield className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <h2 className="text-[16px] font-semibold">
          {mode === "reauth" ? "Confirm it's you" : "Two-step check"}
        </h2>
        <p className="text-[13px] text-muted-foreground">
          {phase === "enroll"
            ? "Scan this with an authenticator app, then enter the 6-digit code."
            : mode === "reauth"
              ? "Enter a fresh code from your authenticator app to continue."
              : "Enter the 6-digit code from your authenticator app to open the admin console."}
        </p>
      </div>

      {phase === "loading" && <Skeleton className="mx-auto h-32 w-full rounded-2xl" />}

      {phase === "enroll" && enrollment && (
        <div className="space-y-2">
          {/* The QR is an SVG data URI from Supabase Auth, not remote content. */}
          <img
            src={enrollment.qr}
            alt="QR code for your authenticator app"
            className="mx-auto h-40 w-40 rounded-xl bg-white p-2"
          />
          <p className="break-all text-[11.5px] text-muted-foreground">
            Or type this key: <span className="font-mono">{enrollment.secret}</span>
          </p>
        </div>
      )}

      {(phase === "enroll" || phase === "verify") && (
        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="sr-only">6-digit code</span>
            <input
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className={cn(fieldClass, "text-center font-mono text-[16px] tracking-[0.4em]")}
              autoFocus
            />
          </label>
          <Button type="submit" disabled={busy || code.length !== 6} className="w-full">
            {busy ? "Checking…" : "Verify"}
          </Button>
        </form>
      )}

      {phase === "error" && (
        <Button variant="outline" onClick={() => void load()}>
          Try again
        </Button>
      )}

      {message && (
        <p role="alert" className="text-[12.5px] text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

"use client";

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Loader2,
  RefreshCw,
  Sparkles,
} from "@/components/ui/gemini-icons";
import { useNavigate } from "@/lib/navigation";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { emptyDna, type BrandDna } from "@/hooks/use-brand-dna";
import { buildDesignMd, saveDesignMd } from "@/lib/design-md";
import { Logo } from "@/components/brand/Logo";
import { toast } from "sonner";

type Step = "website" | "scan" | "review" | "done";
type ScanStatus = "idle" | "loading" | "ok" | "error";
type Progress = { stage: string; message: string; pct: number };
const SCAN_SYMBOLS = ["1Sym.svg", "2Sym.svg", "3Sym.svg", "4Sym.svg"];

function normalizeUrl(raw: string) {
  const value = raw.trim();
  return value ? (/^https?:\/\//i.test(value) ? value : `https://${value}`) : "";
}

function validUrl(raw: string) {
  try {
    const url = new URL(normalizeUrl(raw));
    return url.protocol === "https:" && url.hostname.includes(".");
  } catch {
    return false;
  }
}

const enterProps = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: [0.22, 1, 0.36, 1] as const },
};

function Onboarding() {
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("website");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [brand, setBrand] = useState<Partial<BrandDna>>({});
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({ stage: "idle", message: "", pct: 0 });
  const [saving, setSaving] = useState(false);
  const scanFor = useRef<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);

  const urlKey = (id: string) => `onboarding:website:${id}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) {
        navigate({ to: "/login" });
        return;
      }
      const selectedId = localStorage.getItem("workspace:selected");
      const query = supabase.from("workspaces").select("id, onboarded_at, website_url");
      const { data: workspace } = selectedId
        ? await query.eq("id", selectedId).maybeSingle()
        : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (!workspace?.id) {
        navigate({ to: "/projects" });
        return;
      }
      if (workspace.onboarded_at) {
        navigate({ to: "/app" });
        return;
      }
      localStorage.setItem("workspace:selected", workspace.id);
      setWorkspaceId(workspace.id);
      const recovered = localStorage.getItem(urlKey(workspace.id)) || workspace.website_url || "";
      if (recovered) {
        setWebsiteUrl(recovered);
        setStep("scan");
      }
    })();
    return () => {
      cancelled = true;
      scanAbort.current?.abort();
    };
  }, [navigate]);

  const runScan = async (rawUrl: string, attempt = 0) => {
    const url = normalizeUrl(rawUrl);
    if (!workspaceId || !validUrl(url) || (scanStatus === "loading" && attempt === 0)) return;
    if (scanFor.current === url && scanStatus === "ok") {
      setStep("review");
      return;
    }

    scanFor.current = url;
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setWebsiteUrl(url);
    localStorage.setItem(urlKey(workspaceId), url);
    setStep("scan");
    setScanStatus("loading");
    setScanError(null);
    setProgress({ stage: "fetch_home", message: "Connecting to your website", pct: 3 });
    let latestPct = 3;

    await supabase.from("workspaces").update({ website_url: url }).eq("id", workspaceId);

    try {
      const response = await authedFetch("/api/brand-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || "We couldn't read that website.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let result: Partial<BrandDna> | null = null;
      let streamError: string | null = null;
      let malformedEvents = 0;

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const event = JSON.parse(line) as {
            type?: string;
            stage?: string;
            message?: string;
            pct?: number;
            data?: Partial<BrandDna>;
            error?: string;
          };
          if (event.type === "progress") {
            latestPct = Math.max(latestPct, event.pct ?? latestPct);
            setProgress({
              stage: event.stage || "working",
              message: event.message || "Understanding your brand",
              pct: latestPct,
            });
          } else if (event.type === "result") {
            result = event.data || null;
          } else if (event.type === "error") {
            streamError = event.error || "We couldn't complete the scan.";
          }
        } catch {
          malformedEvents += 1;
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          processLine(buffer);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) processLine(line);
      }

      if (streamError) throw new Error(streamError);
      if (malformedEvents > 0)
        throw new Error("The scan response was incomplete. Please try again.");
      if (!result) throw new Error("We couldn't build Brand DNA from that site.");
      setBrand(Object.assign({}, result, { websiteUrl: url }));
      setProgress({ stage: "done", message: "Brand DNA is ready to review", pct: 100 });
      setScanStatus("ok");
      setStep("review");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (attempt < 2) {
        setProgress({
          stage: "retry",
          message: `The connection took longer than expected. Retrying scan (${attempt + 2}/3)...`,
          pct: Math.max(latestPct, 8),
        });
        await new Promise((resolve) => window.setTimeout(resolve, 900 * (attempt + 1)));
        if (!controller.signal.aborted) await runScan(url, attempt + 1);
        return;
      }
      setScanStatus("error");
      setScanError(
        error instanceof Error
          ? error.message
          : "We couldn't complete the scan after a few attempts.",
      );
    }
  };

  useEffect(() => {
    if (step !== "scan" || !workspaceId || !websiteUrl || scanStatus !== "idle") return;
    void runScan(websiteUrl);
    // The guarded status check makes refresh recovery run once for the persisted URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, workspaceId, websiteUrl, scanStatus]);

  const finish = async () => {
    if (!workspaceId || saving) return;
    setSaving(true);
    const finalUrl = normalizeUrl(websiteUrl);
    const { error } = await supabase
      .from("workspaces")
      .update({
        website_url: finalUrl,
        industry: brand.industry?.trim() || null,
        audience: brand.audience?.trim() || null,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);
    if (error) {
      setSaving(false);
      toast.error("Couldn't finish setup", {
        description: "Your edits are still here. Try again.",
      });
      return;
    }

    const merged: BrandDna = {
      ...emptyDna,
      ...brand,
      websiteUrl: finalUrl,
      status: scanStatus === "ok" ? "ok" : "idle",
      extractedAt: scanStatus === "ok" ? Date.now() : null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(`brand-dna:v3:${workspaceId}`, JSON.stringify(merged));
    localStorage.removeItem(urlKey(workspaceId));
    try {
      saveDesignMd(workspaceId, buildDesignMd(merged));
    } catch {}
    setSaving(false);
    setStep("done");
  };

  const skip = async () => {
    if (!workspaceId || saving) return;
    scanAbort.current?.abort();
    setSaving(true);
    const finalUrl = normalizeUrl(websiteUrl);
    const { error } = await supabase
      .from("workspaces")
      .update({
        website_url: finalUrl || null,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);
    if (error) {
      setSaving(false);
      toast.error("Couldn't skip setup", { description: "Your URL is still saved. Try again." });
      return;
    }
    const partial: BrandDna = {
      ...emptyDna,
      ...brand,
      websiteUrl: finalUrl || null,
      status: "idle",
      extractedAt: null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(`brand-dna:v3:${workspaceId}`, JSON.stringify(partial));
    localStorage.removeItem(urlKey(workspaceId));
    setSaving(false);
    navigate({ to: "/app" });
  };

  const stepIndex = ["website", "scan", "review", "done"].indexOf(step);
  const progressWidth = `${((stepIndex + 1) / 4) * 100}%`;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
        <Logo height={32} />
        {step !== "done" && (
          <button
            type="button"
            onClick={() => void skip()}
            disabled={saving}
            className="inline-flex h-8 items-center rounded-lg px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {saving ? "Saving..." : "Skip for now"}
          </button>
        )}
      </header>
      <div className="h-0.5 w-full bg-border">
        <motion.div className="h-full bg-primary" animate={{ width: progressWidth }} />
      </div>

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait" initial={false}>
            {step === "website" && (
              <motion.div key="website" {...enterProps}>
                <StepHeader
                  icon={<Globe />}
                  eyebrow="Start with your website"
                  title="We'll understand your brand for you."
                  subtitle="Give Mellox your website once. We'll use it to build your Brand DNA and prepare your workspace."
                />
                <form
                  className="mt-8"
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (validUrl(websiteUrl)) void runScan(websiteUrl);
                  }}
                >
                  <div className="focus-glow flex items-center gap-2 rounded-2xl border border-border bg-card px-4 py-4 shadow-[0_12px_40px_-28px_hsl(var(--foreground)/0.5)]">
                    <Globe className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                    <input
                      autoFocus
                      required
                      type="url"
                      value={websiteUrl}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      placeholder="https://yourcompany.com"
                      aria-label="Website URL"
                      className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                    />
                    <button
                      type="submit"
                      disabled={!validUrl(websiteUrl)}
                      className="inline-flex h-10 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:-translate-y-px disabled:pointer-events-none disabled:opacity-40"
                    >
                      Scan my brand <ArrowRight className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                  <p className="mt-3 text-center text-[12px] text-muted-foreground">
                    We'll scan public pages only. You can review every result before entering
                    Mellox.
                  </p>
                </form>
              </motion.div>
            )}
            {step === "scan" && (
              <motion.div key="scan" {...enterProps}>
                <ScanView
                  url={websiteUrl}
                  status={scanStatus}
                  progress={progress}
                  error={scanError}
                  onRetry={() => void runScan(websiteUrl)}
                  onEdit={() => setStep("website")}
                  onSkip={() => void skip()}
                />
              </motion.div>
            )}
            {step === "review" && (
              <motion.div key="review" {...enterProps}>
                <ReviewView
                  brand={brand}
                  onChange={(patch) => setBrand((current) => ({ ...current, ...patch }))}
                  onBack={() => setStep("scan")}
                  onContinue={() => void finish()}
                  saving={saving}
                />
              </motion.div>
            )}
            {step === "done" && (
              <motion.div key="done" {...enterProps} className="text-center">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary text-primary-foreground shadow-[0_12px_32px_-12px_hsl(var(--primary)/0.7)]">
                  <Check className="h-8 w-8" strokeWidth={2.5} />
                </div>
                <h1 className="mt-6 text-3xl font-semibold tracking-tight">
                  Your workspace is ready.
                </h1>
                <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-muted-foreground">
                  Mellox now has the context to make every draft, insight, and recommendation feel
                  like your brand.
                </p>
                <button
                  onClick={() => navigate({ to: "/app" })}
                  className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground transition hover:-translate-y-px"
                >
                  Enter Mellox <ArrowRight className="h-4 w-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function StepHeader({
  icon,
  eyebrow,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-border bg-card text-primary">
          {icon}
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {eyebrow}
        </span>
      </div>
      <h1 className="max-w-xl text-[clamp(2rem,5vw,3.25rem)] font-semibold leading-[1.05] tracking-[-0.035em]">
        {title}
      </h1>
      <p className="mt-3 max-w-lg text-[14px] leading-relaxed text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function ScanView({
  url,
  status,
  progress,
  error,
  onRetry,
  onEdit,
  onSkip,
}: {
  url: string;
  status: ScanStatus;
  progress: Progress;
  error: string | null;
  onRetry: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  const failed = status === "error";
  const Icon = failed ? RefreshCw : status === "ok" ? Check : Loader2;
  return (
    <div className="text-center">
      {status === "loading" ? (
        <ScanSymbols />
      ) : (
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl border border-border bg-card text-primary shadow-sm">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        DNA Scan
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        {failed
          ? "We couldn't read that site"
          : status === "ok"
            ? "Brand DNA is ready"
            : "Understanding your brand"}
      </h1>
      <p className="mx-auto mt-2 max-w-lg truncate text-[13px] text-muted-foreground">{url}</p>
      <div className="mx-auto mt-8 max-w-md text-left">
        <div className="h-2 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full bg-primary"
            animate={{ width: `${status === "ok" ? 100 : progress.pct}%` }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          />
        </div>
        <p aria-live="polite" className="mt-3 text-center text-[13px] text-muted-foreground">
          {failed
            ? error
            : status === "ok"
              ? "Scan complete. Preparing your review..."
              : progress.message || "Connecting to your website"}
        </p>
      </div>
      {failed && (
        <div className="mt-7 flex justify-center gap-2">
          <button
            onClick={onEdit}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Edit URL
          </button>
          <button
            onClick={onRetry}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Try again
          </button>
        </div>
      )}
      {status === "loading" && (
        <button
          type="button"
          onClick={onSkip}
          className="mt-5 text-[12px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
        >
          Skip for now and enter Mellox
        </button>
      )}
    </div>
  );
}

function ScanSymbols() {
  const [active, setActive] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setActive((value) => (value + 1) % SCAN_SYMBOLS.length),
      900,
    );
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className="relative mx-auto grid h-20 w-20 place-items-center rounded-[1.4rem] border border-border/70 bg-card shadow-[0_16px_42px_-18px_hsl(var(--foreground)/0.55)]"
      aria-label="Scanning your brand"
      role="status"
    >
      <span className="absolute inset-1 rounded-[1.1rem] border border-primary/15" aria-hidden />
      <AnimatePresence mode="wait" initial={false}>
        <motion.img
          key={SCAN_SYMBOLS[active]}
          src={`/assets/stars/${SCAN_SYMBOLS[active]}`}
          alt=""
          className="h-11 w-11 object-contain"
          initial={{ opacity: 0, scale: 0.72, rotate: -8 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 1.12, rotate: 8 }}
          transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
        />
      </AnimatePresence>
      <motion.span
        aria-hidden
        className="absolute -inset-2 -z-10 rounded-[1.8rem] border border-primary/10"
        animate={{ opacity: [0.25, 0.65, 0.25], scale: [0.96, 1.04, 0.96] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function ReviewView({
  brand,
  onChange,
  onBack,
  onContinue,
  saving,
}: {
  brand: Partial<BrandDna>;
  onChange: (patch: Partial<BrandDna>) => void;
  onBack: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const fields = [
    ["brandName", "Brand name", "Your company name"],
    ["oneLiner", "Positioning", "What you do, for whom, and why it matters"],
    ["industry", "Industry", "e.g. B2B SaaS"],
    ["audience", "Audience", "Who you serve"],
    ["voice", "Brand voice", "How you sound"],
    ["products", "Products or services", "What you sell"],
  ] as const;
  const filled = fields.filter(([key]) => String(brand[key] || "").trim()).length;
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
            Scan complete
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Review your Brand DNA.</h1>
          <p className="mt-2 text-[13.5px] text-muted-foreground">
            {filled} of {fields.length} essentials found. Keep what's right and adjust anything that
            needs your voice.
          </p>
        </div>
        <Sparkles className="mt-1 h-6 w-6 shrink-0 text-primary" />
      </div>
      <div className="mt-7 grid gap-3 sm:grid-cols-2">
        {fields.map(([key, label, placeholder]) => (
          <label key={key} className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              {label}
            </span>
            <input
              value={String(brand[key] || "")}
              onChange={(event) => onChange({ [key]: event.target.value })}
              placeholder={placeholder}
              className="h-11 w-full rounded-xl border border-border bg-card px-3.5 text-[13.5px] outline-none transition focus:border-primary focus:ring-2 focus:ring-primary-border"
            />
          </label>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to scan
        </button>
        <button
          onClick={onContinue}
          disabled={saving}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground transition hover:-translate-y-px disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{" "}
          {saving ? "Saving Brand DNA..." : "Enter Mellox"}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default Onboarding;

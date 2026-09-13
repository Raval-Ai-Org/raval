"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { toast } from "sonner";
import { Check } from "@/components/icons";
import { Logo } from "@/components/brand/Logo";
import { BrandReveal, type BrandEdits } from "@/components/onboarding/BrandReveal";
import { SCAN_PHASES, advancePhase } from "@/components/onboarding/phases";
import { ScanStage, type ScanProgress, type ScanStatus } from "@/components/onboarding/ScanStage";
import { SuccessMoment } from "@/components/onboarding/SuccessMoment";
import { AmbientCanvas } from "@/components/onboarding/ui";
import { UrlStep } from "@/components/onboarding/UrlStep";
import { normalizeUrl, validUrl } from "@/components/onboarding/url";
import { emptyDna, type BrandDna } from "@/hooks/use-brand-dna";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { mergeExtractionIntoDna } from "@/lib/brand-dna-merge";
import type { BrandExtractResult, Discoveries } from "@/lib/brand-extract-events";
import { readBrandExtractStream } from "@/lib/brand-extract-stream";
import { buildDesignMd, saveDesignMd } from "@/lib/design-md";
import { duration, ease } from "@/lib/motion";
import { useNavigate } from "@/lib/navigation";

type Step = "website" | "scan" | "review" | "done";

const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "website", label: "Website" },
  { id: "scan", label: "Scan" },
  { id: "review", label: "Brand DNA" },
];

const STEP_WIDTH: Record<Step, string> = {
  website: "max-w-2xl",
  scan: "max-w-[460px]",
  review: "max-w-6xl",
  done: "max-w-xl",
};

/** Hold on the completed scan so the final phase visibly lands before the reveal. */
const COMPLETE_BEAT_MS = 700;

const IDLE_PROGRESS: ScanProgress = { stage: "idle", message: "", pct: 0 };

/**
 * Brand DNA for storage: the extraction result mapped through the shared
 * merge (so `customerSignals`, `insights` and competitor ids land where the
 * app expects them), with the user's review edits on top.
 */
function buildBrandDna(
  result: BrandExtractResult | null,
  edits: BrandEdits,
  url: string | null,
): BrandDna {
  const base = result && url ? mergeExtractionIntoDna(emptyDna, result, url).dna : emptyDna;
  const cleanEdits = Object.fromEntries(
    Object.entries(edits).map(([key, value]) => [key, (value ?? "").trim()]),
  );
  return { ...base, ...cleanEdits, websiteUrl: url };
}

function Onboarding() {
  const navigate = useNavigate();
  const reduce = useReducedMotionSafe();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("website");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [result, setResult] = useState<BrandExtractResult | null>(null);
  const [edits, setEdits] = useState<BrandEdits>({});
  const [discoveries, setDiscoveries] = useState<Discoveries>({});
  const [phase, setPhase] = useState(0);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress>(IDLE_PROGRESS);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const scanFor = useRef<string | null>(null);
  const resultFor = useRef<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  const urlKey = (id: string) => `onboarding:website:${id}`;
  const brand: BrandExtractResult = { ...result, ...edits };

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

  // Each new step moves focus to its heading, so keyboard and screen-reader
  // users land on the new content instead of a control that no longer exists.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    const timer = window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 60);
    return () => window.clearTimeout(timer);
  }, [step, reduce]);

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
    if (attempt === 0) {
      // A retry keeps what was already discovered on screen; a new scan starts clean.
      setDiscoveries({});
      setPhase(0);
    }
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

      const outcome = await readBrandExtractStream(response.body, {
        onProgress: (event) => {
          if (controller.signal.aborted) return;
          latestPct = Math.max(latestPct, event.pct);
          setProgress({
            stage: event.stage,
            message: event.message || "Understanding your brand",
            pct: latestPct,
          });
          setPhase((current) => advancePhase(current, event.stage));
        },
        onDiscovery: (event) => {
          if (controller.signal.aborted) return;
          setDiscoveries((current) => ({ ...current, [event.kind]: event.data }));
        },
      });

      if (controller.signal.aborted) return;
      if (outcome.error) throw new Error(outcome.error);
      if (outcome.malformed > 0)
        throw new Error("The scan response was incomplete. Please try again.");
      if (!outcome.result) throw new Error("We couldn't build Brand DNA from that site.");

      // Edits survive "Scan again" on the same site, not a different one.
      if (resultFor.current !== url) setEdits({});
      resultFor.current = url;
      setResult(outcome.result);
      setProgress({ stage: "done", message: "Brand DNA is ready to review", pct: 100 });
      setPhase(SCAN_PHASES.length - 1);
      setScanStatus("ok");
      if (!reduce) await new Promise((resolve) => window.setTimeout(resolve, COMPLETE_BEAT_MS));
      if (!controller.signal.aborted) setStep("review");
    } catch (error) {
      if (controller.signal.aborted) return;
      if (attempt < 2) {
        setProgress({
          stage: "retry",
          message: `The connection took longer than expected. Retrying scan (${attempt + 2}/3)…`,
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

  const rescan = () => {
    scanFor.current = null;
    void runScan(websiteUrl);
  };

  const finish = async () => {
    if (!workspaceId || saving) return;
    setSaving(true);
    const finalUrl = normalizeUrl(websiteUrl);
    const dna = buildBrandDna(result, edits, finalUrl);
    const { error } = await supabase
      .from("workspaces")
      .update({
        website_url: finalUrl,
        industry: dna.industry.trim() || null,
        audience: dna.audience.trim() || null,
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
      ...dna,
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
      ...buildBrandDna(result, edits, finalUrl || null),
      status: "idle",
      extractedAt: null,
      updatedAt: Date.now(),
    };
    localStorage.setItem(`brand-dna:v3:${workspaceId}`, JSON.stringify(partial));
    localStorage.removeItem(urlKey(workspaceId));
    setSaving(false);
    navigate({ to: "/app" });
  };

  const enterApp = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(() => navigate({ to: "/app" }), reduce ? 0 : duration.slow * 1000);
  };

  const stepMotion = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: { duration: duration.xslow, ease: ease.emphasized } },
    exit: { opacity: 0, transition: { duration: duration.base, ease: ease.accelerate } },
  };
  const centered = step !== "review";

  return (
    <motion.div
      className="relative flex min-h-[100dvh] flex-col overflow-x-clip bg-background text-foreground"
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: duration.slow, ease: ease.accelerate }}
    >
      <AmbientCanvas />
      <header className="relative z-10 grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 border-b border-border/70 px-4 sm:px-6">
        <span className="sm:hidden">
          <Logo markOnly height={28} />
        </span>
        <span className="hidden sm:block">
          <Logo height={30} />
        </span>
        <StepIndicator step={step} />
        <div className="justify-self-end">
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
        </div>
      </header>

      <main
        className={`relative z-10 flex flex-1 justify-center px-4 py-8 sm:px-6 sm:py-12 ${centered ? "items-center" : "items-start"}`}
      >
        {/* One child: the global `main > * + *` rhythm would offset the entering step. */}
        <div className="relative flex w-full justify-center">
          <LayoutGroup>
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.div key={step} {...stepMotion} className={`w-full ${STEP_WIDTH[step]}`}>
                {step === "website" && (
                  <UrlStep
                    value={websiteUrl}
                    reduce={reduce}
                    headingRef={headingRef}
                    onChange={setWebsiteUrl}
                    onSubmit={() => void runScan(websiteUrl)}
                  />
                )}
                {step === "scan" && (
                  <ScanStage
                    url={websiteUrl}
                    status={scanStatus}
                    progress={progress}
                    phase={phase}
                    discoveries={discoveries}
                    error={scanError}
                    reduce={reduce}
                    headingRef={headingRef}
                    onRetry={() => void runScan(websiteUrl)}
                    onEdit={() => setStep("website")}
                    onSkip={() => void skip()}
                  />
                )}
                {step === "review" && (
                  <BrandReveal
                    brand={brand}
                    url={websiteUrl}
                    saving={saving}
                    reduce={reduce}
                    headingRef={headingRef}
                    onChange={(patch) => setEdits((current) => ({ ...current, ...patch }))}
                    onContinue={() => void finish()}
                    onRescan={rescan}
                    onChangeUrl={() => setStep("website")}
                  />
                )}
                {step === "done" && (
                  <SuccessMoment
                    brand={brand}
                    url={websiteUrl}
                    reduce={reduce}
                    leaving={leaving}
                    headingRef={headingRef}
                    onEnter={enterApp}
                  />
                )}
              </motion.div>
            </AnimatePresence>
          </LayoutGroup>
        </div>
      </main>
    </motion.div>
  );
}

function StepIndicator({ step }: { step: Step }) {
  const current = step === "done" ? STEPS.length : STEPS.findIndex((s) => s.id === step);
  return (
    <ol aria-label="Setup progress" className="flex items-center">
      {STEPS.map((item, index) => {
        const state = index < current ? "done" : index === current ? "active" : "pending";
        return (
          <li
            key={item.id}
            aria-current={state === "active" ? "step" : undefined}
            className="flex items-center"
          >
            {index > 0 && (
              <span
                aria-hidden
                className={`mx-1.5 h-px w-4 transition-colors duration-500 sm:mx-2.5 sm:w-8 ${index <= current ? "bg-primary" : "bg-border"}`}
              />
            )}
            <span
              className={`inline-flex items-center gap-1.5 text-[12px] transition-colors ${state === "pending" ? "text-muted-foreground" : "text-foreground"}`}
            >
              <span
                className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold transition-colors duration-300 ${
                  state === "done"
                    ? "bg-primary text-primary-foreground"
                    : state === "active"
                      ? "border border-primary text-primary"
                      : "border border-border text-muted-foreground"
                }`}
              >
                {state === "done" ? (
                  <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                ) : (
                  index + 1
                )}
              </span>
              <span className="hidden sm:inline">{item.label}</span>
              {state === "done" && <span className="sr-only">(complete)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default Onboarding;

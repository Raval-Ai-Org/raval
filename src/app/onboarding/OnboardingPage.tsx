"use client";

import { Spinner } from "@/components/icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { toast } from "@/lib/toast";
import { Logo } from "@/components/brand/Logo";
import { BrandReveal, type BrandEdits } from "@/components/onboarding/BrandReveal";
import { SCAN_PHASES, advancePhase } from "@/components/onboarding/phases";
import { ScanStage, type ScanProgress, type ScanStatus } from "@/components/onboarding/ScanStage";
import { ScanStrip } from "@/components/onboarding/ScanStrip";
import type { CompetitorResearchStatus } from "@/components/onboarding/CompetitorResearchPreview";
import { AmbientCanvas } from "@/components/onboarding/ui";
import { UrlStep } from "@/components/onboarding/UrlStep";
import {
  GoalStep,
  emptyGoalDraft,
  goalDraftFrom,
  goalDraftToRaw,
  type GoalDraft,
} from "@/components/onboarding/GoalStep";
import {
  ManualBrandStep,
  emptyManualBrand,
  type ManualBrand,
} from "@/components/onboarding/ManualBrandStep";
import { useManualInspiration } from "@/components/onboarding/manual/use-manual-inspiration";
import { manualDnaFields, readManualDraft, type ManualPart } from "@/lib/onboarding/manual-brand";
import { ProductsStep } from "@/components/onboarding/ProductsStep";
import { ChannelsStep } from "@/components/onboarding/ChannelsStep";
import { LanguageStep, browserContentLanguage } from "@/components/onboarding/LanguageStep";
import { withLanguage } from "@/lib/brand-look/languages";
import { tidyLook } from "@/lib/inspo/look";
import { VisorTransition, markEntryBloom } from "@/components/brand/mox/VisorTransition";
import { FinishStep } from "@/components/onboarding/FinishStep";
import { SocialAccountsSection } from "@/components/app/SocialAccountsSection";
import { hostOf, normalizeUrl, validUrl } from "@/components/onboarding/url";
import { useOnboardingProducts } from "@/components/onboarding/use-onboarding-products";
import { emptyDna, flushBrandDnaFor, saveBrandDnaFor, type BrandDna } from "@/hooks/use-brand-dna";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { workspacePath } from "@/lib/workspace/paths";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { userSafeMessage } from "@/lib/user-errors";
import { mergeExtractionIntoDna } from "@/lib/brand-dna-merge";
import type { BrandExtractResult, Discoveries, SiteDiscovery } from "@/lib/brand-extract-events";
import {
  bootstrapCompetitors,
  getCompetitorOverview,
  type CompetitorView,
} from "@/lib/competitors.functions";
import { getGoals, saveGoals } from "@/lib/goals.functions";
import type { WorkspaceGoals } from "@/lib/goals/contracts";
import {
  blockedReason,
  indicatorIndex,
  indicatorSteps,
  nextStep,
  previousStep,
  type FlowMode,
  type FlowState,
  type OnboardingStep,
} from "@/lib/onboarding/flow";
import { productsSummary } from "@/lib/products/catalog";
import { readBrandExtractStream } from "@/lib/brand-extract-stream";
import { duration, ease } from "@/lib/motion";
import { useNavigate } from "@/lib/navigation";

type Step = OnboardingStep;

/** workspaces_owner_domain_unique: this owner already has the brand's domain. */
function isDuplicateDomainError(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error && (error.code === "23505" || /workspaces_owner_domain_unique/.test(error.message ?? "")),
  );
}

const STEP_WIDTH: Record<Step, string> = {
  website: "max-w-2xl",
  manual: "max-w-5xl",
  goals: "max-w-3xl",
  scan: "max-w-[460px]",
  review: "max-w-6xl",
  language: "max-w-3xl",
  products: "max-w-5xl",
  channels: "max-w-3xl",
  first: "max-w-5xl",
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
  // Onboarding runs for the workspace in the URL (/w/<id>/onboarding) — never
  // the last-selected or newest one.
  const workspace = useWorkspace();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [mode, setMode] = useState<FlowMode>("site");
  const [step, setStepState] = useState<Step>("website");
  const stepRef = useRef<Step>("website");
  const setStep = useCallback((next: Step) => {
    stepRef.current = next;
    setStepState(next);
  }, []);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [result, setResult] = useState<BrandExtractResult | null>(null);
  const [edits, setEdits] = useState<BrandEdits>({});
  const [manual, setManual] = useState<ManualBrand>(emptyManualBrand);
  const [manualPart, setManualPart] = useState<ManualPart>("basics");
  // The brand's content language (Mellox 2.0): what Mox writes in. Starts
  // from the browser's language; saved on the look before products.
  const [language, setLanguage] = useState("English");
  useEffect(() => setLanguage(browserContentLanguage()), []);
  const [discoveries, setDiscoveries] = useState<Discoveries>({});
  const [phase, setPhase] = useState(0);
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ScanProgress>(IDLE_PROGRESS);
  const [competitors, setCompetitors] = useState<CompetitorView[]>([]);
  const [competitorResearchStatus, setCompetitorResearchStatus] =
    useState<CompetitorResearchStatus>("idle");
  const [goalDraft, setGoalDraft] = useState<GoalDraft>(emptyGoalDraft);
  const [goals, setGoals] = useState<WorkspaceGoals | null>(null);
  const [goalSaving, setGoalSaving] = useState(false);
  const [goalError, setGoalError] = useState<string | null>(null);
  const [goalWarnings, setGoalWarnings] = useState<string[]>([]);
  const [connected, setConnected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const scanFor = useRef<string | null>(null);
  const resultFor = useRef<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const competitorRun = useRef<Promise<void> | null>(null);
  const competitorFor = useRef<string | null>(null);
  const competitorGeneration = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  const urlKey = (id: string) => `onboarding:website:${id}`;
  // The no-website brand kit survives a refresh (this browser only).
  const manualKey = (id: string) => `onboarding:manual:${id}`;
  const inspiration = useManualInspiration(workspaceId);
  const brand: BrandExtractResult =
    mode === "manual"
      ? {
          brandName: manual.brandName,
          oneLiner: manual.oneLiner,
          industry: manual.industry,
          about: manual.about,
          audience: manual.audience,
        }
      : { ...result, ...edits };
  const brandName = brand.brandName?.trim() || workspace.name || "";

  const catalogue = useOnboardingProducts(workspaceId);
  const candidates = useMemo(
    () => discoveries.products?.products ?? result?.productCandidates ?? [],
    [discoveries.products, result?.productCandidates],
  );
  // What the scan finds is kept as it arrives, while the person sets their
  // goal, so the products step is already filled in when they get there.
  const { autoKeep } = catalogue;
  useEffect(() => {
    if (mode === "site" && candidates.length) autoKeep(candidates);
  }, [mode, candidates, autoKeep]);

  const flow: FlowState = {
    mode,
    scan: scanStatus,
    goalsSaved: Boolean(goals),
    activeProducts: catalogue.products.length,
  };

  useEffect(() => {
    if (workspace.onboarded) {
      navigate({ to: workspacePath(workspace.id), replace: true });
      return;
    }
    setWorkspaceId(workspace.id);
    let recovered = "";
    try {
      recovered = localStorage.getItem(urlKey(workspace.id)) || "";
    } catch {
      /* storage unavailable */
    }
    recovered ||= workspace.websiteUrl ?? "";
    let draft: ManualBrand | null = null;
    try {
      draft = readManualDraft(JSON.parse(localStorage.getItem(manualKey(workspace.id)) || "null"));
    } catch {
      /* storage unavailable or unreadable */
    }
    if (recovered) {
      setWebsiteUrl(recovered);
      setStep("goals");
    } else if (draft) {
      // A brand kit typed before a refresh: back to it, nothing lost.
      setManual(draft);
      setMode("manual");
      setStep("manual");
    } else if (new URLSearchParams(window.location.search).get("start") === "manual") {
      // "No website?" on the projects page: straight to the brand kit, no scan.
      setMode("manual");
      setStep("manual");
    }
    // A goal set before a refresh is kept.
    void getGoals({ data: { workspaceId: workspace.id } })
      .then((view) => {
        if (view.goals) {
          setGoals(view.goals);
          setGoalDraft(goalDraftFrom(view.goals));
        }
      })
      .catch(() => undefined);
    return () => {
      scanAbort.current?.abort();
    };
    // The workspace object is stable for this mount (the provider is keyed by id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  useEffect(() => {
    if (!workspaceId || mode !== "manual") return;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(manualKey(workspaceId), JSON.stringify(manual));
      } catch {
        /* storage full or unavailable */
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [workspaceId, mode, manual]);

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
  }, [step, reduce, manualPart]);

  const startCompetitorResearch = (site: SiteDiscovery) => {
    if (!workspaceId || competitorFor.current === site.hostname) return;
    competitorFor.current = site.hostname;
    const generation = ++competitorGeneration.current;
    setCompetitorResearchStatus("searching");
    competitorRun.current = bootstrapCompetitors({
      data: {
        workspaceId,
        scanSeed: {
          hostname: site.hostname,
          siteName: (site.siteName || site.title.split(/[|·—-]/)[0]?.trim() || "").slice(0, 100),
          description: site.description,
        },
      },
    }).then(
      (research) => {
        if (generation !== competitorGeneration.current) return;
        setCompetitors(research.competitors);
        setCompetitorResearchStatus("ready");
      },
      () => {
        if (generation === competitorGeneration.current) setCompetitorResearchStatus("error");
      },
    );
  };

  useEffect(() => {
    if (
      !workspaceId ||
      competitorResearchStatus !== "ready" ||
      !competitors.some(
        (entry) => entry.profileStatus === "pending" || entry.profileStatus === "running",
      )
    )
      return;
    const timer = window.setInterval(() => {
      void getCompetitorOverview({ data: { workspaceId } })
        .then((overview) => setCompetitors(overview.competitors.slice(0, 6)))
        .catch(() => undefined);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [workspaceId, competitorResearchStatus, competitors]);

  /**
   * Scan the site in the background. The person answers the goal questions
   * meanwhile; the review opens when both are done.
   */
  const runScan = async (rawUrl: string, attempt = 0) => {
    const url = normalizeUrl(rawUrl);
    if (!workspaceId || !validUrl(url) || (scanStatus === "loading" && attempt === 0)) return;
    if (scanFor.current === url && scanStatus === "ok") return;

    scanFor.current = url;
    const nextHost = new URL(url).hostname.replace(/^www\./, "");
    if (competitorFor.current && competitorFor.current !== nextHost) {
      competitorGeneration.current += 1;
      competitorFor.current = null;
      competitorRun.current = null;
      setCompetitors([]);
      setCompetitorResearchStatus("idle");
    }
    scanAbort.current?.abort();
    const controller = new AbortController();
    scanAbort.current = controller;
    setWebsiteUrl(url);
    try {
      localStorage.setItem(urlKey(workspaceId), url);
    } catch {
      /* storage unavailable */
    }
    setScanStatus("loading");
    setScanError(null);
    if (attempt === 0) {
      // A retry keeps what was already discovered on screen; a new scan starts clean.
      setDiscoveries({});
      setPhase(0);
    }
    setProgress({ stage: "fetch_home", message: "Connecting to your website", pct: 3 });
    let latestPct = 3;

    const { error: siteError } = await supabase
      .from("workspaces")
      .update({ website_url: url })
      .eq("id", workspaceId);
    if (isDuplicateDomainError(siteError)) {
      setScanStatus("idle");
      setStep("website");
      toast.error("You already have a workspace for this website", {
        description: "Open it from Workspaces instead of creating a second copy of the brand.",
      });
      return;
    }
    if (siteError) {
      setScanStatus("error");
      setScanError("We couldn't save this website to your workspace. Please try again.");
      return;
    }

    try {
      const response = await authedFetch("/api/brand-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
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
          if (event.kind === "site") startCompetitorResearch(event.data);
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
      if (stepRef.current === "scan") {
        if (!reduce) await new Promise((resolve) => window.setTimeout(resolve, COMPLETE_BEAT_MS));
        if (!controller.signal.aborted && stepRef.current === "scan") setStep("review");
      }
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
        userSafeMessage(
          error instanceof Error ? error.message : null,
          "We couldn't finish reading your site. Please try again.",
        ),
      );
    }
  };

  // Recovery after a refresh: the persisted URL is scanned once.
  useEffect(() => {
    if (mode !== "site" || !workspaceId || !websiteUrl || scanStatus !== "idle") return;
    if (step === "website") return;
    void runScan(websiteUrl);
    // The guarded status check makes refresh recovery run once for the persisted URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, workspaceId, websiteUrl, scanStatus, mode]);

  const rescan = () => {
    scanFor.current = null;
    setStep("scan");
    void runScan(websiteUrl);
  };

  const go = (from: Step) => setStep(nextStep(from, flow));
  const back = (from: Step) => {
    const prev = previousStep(from, flow);
    if (prev) setStep(prev);
  };

  const submitGoals = async () => {
    if (!workspaceId || goalSaving) return;
    setGoalSaving(true);
    setGoalError(null);
    try {
      const saved = await saveGoals({
        data: { workspaceId, goals: goalDraftToRaw(goalDraft) },
      });
      setGoals(saved.goals);
      const warnings = saved.warnings.map((w) => w.message);
      setGoalWarnings(warnings);
      if (saved.goals) {
        // A stretch is shown once on this step, then the person moves on.
        if (warnings.length && goalWarnings.join() !== warnings.join()) {
          toast.message("Goal saved", { description: warnings[0] });
        }
        setStep(nextStep("goals", { ...flow, goalsSaved: true }));
      }
    } catch (error) {
      setGoalError(error instanceof Error ? error.message : "Couldn't save your goal. Try again.");
    } finally {
      setGoalSaving(false);
    }
  };

  /** The Brand DNA as it stands: scan + review edits, or the manual answers. */
  const siteUrl = (): string | null => {
    const url = normalizeUrl(websiteUrl);
    return url && validUrl(url) ? url : null;
  };

  const currentDna = (): BrandDna => {
    const finalUrl = siteUrl();
    const base =
      mode === "manual"
        ? { ...emptyDna, ...manualDnaFields(manual), websiteUrl: finalUrl }
        : buildBrandDna(result, edits, finalUrl);
    const summary = productsSummary(catalogue.products);
    return {
      ...base,
      look: tidyLook(withLanguage(base.look ?? {}, language)),
      // The catalogue is what the brand sells; the scan's guess is only a fallback.
      products: summary || base.products,
      status: mode === "site" && scanStatus === "ok" ? "ok" : "idle",
      extractedAt: mode === "site" && scanStatus === "ok" ? Date.now() : null,
      updatedAt: Date.now(),
    };
  };

  const saveDna = async (): Promise<boolean> => {
    if (!workspaceId) return false;
    saveBrandDnaFor(workspaceId, currentDna(), true);
    try {
      await flushBrandDnaFor(workspaceId);
      return true;
    } catch (saveError) {
      toast.error("Couldn't save Brand DNA", {
        description: saveError instanceof Error ? saveError.message : "Try again in a moment.",
      });
      return false;
    }
  };

  const continueFromLanguage = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await saveDna();
    setSaving(false);
    if (ok) go("language");
  };

  const continueFromReview = async () => {
    if (saving) return;
    setSaving(true);
    const ok = await saveDna();
    setSaving(false);
    if (ok) go("review");
  };

  /** The essentials are in: mark the workspace set up. Channels and first posts are extras. */
  const finishSetup = async () => {
    if (!workspaceId || saving) return;
    setSaving(true);
    const dna = currentDna();
    const finalUrl = siteUrl();
    const { error } = await supabase
      .from("workspaces")
      .update({
        website_url: finalUrl,
        ...(mode === "manual" && manual.brandName.trim() ? { name: manual.brandName.trim() } : {}),
        industry: dna.industry.trim() || null,
        audience: dna.audience.trim() || null,
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);
    if (isDuplicateDomainError(error)) {
      setSaving(false);
      toast.error("You already have a workspace for this website");
      return;
    }
    if (error) {
      setSaving(false);
      toast.error("Couldn't finish setup", {
        description: "Your edits are still here. Try again.",
      });
      return;
    }
    const ok = await saveDna();
    setSaving(false);
    if (!ok) return;
    try {
      localStorage.removeItem(urlKey(workspaceId));
      localStorage.removeItem(manualKey(workspaceId));
    } catch {
      /* storage unavailable */
    }
    // The early website search ran alongside the scan. Reconcile it with the
    // completed Brand DNA without adding another onboarding step.
    if (mode === "manual" && manual.competitors.length) {
      // The competitors typed in are on Brand DNA; the included first research
      // lifts them into Brain → Competitors (looking up a site from a name).
      // A plan without competitor tracking skips this quietly.
      void bootstrapCompetitors({ data: { workspaceId } })
        .then((research) => {
          setCompetitors(research.competitors);
          setCompetitorResearchStatus("ready");
        })
        .catch(() => undefined);
    }
    if (mode === "site") {
      void (async () => {
        await competitorRun.current?.catch(() => undefined);
        try {
          const research = await bootstrapCompetitors({ data: { workspaceId } });
          setCompetitors(research.competitors);
          setCompetitorResearchStatus("ready");
        } catch {
          // Competitor research can continue from the main app.
        }
      })();
    }
    go("products");
  };

  const skip = async () => {
    if (!workspaceId || saving) return;
    scanAbort.current?.abort();
    setSaving(true);
    const finalUrl = siteUrl();
    const { error } = await supabase
      .from("workspaces")
      .update({
        website_url: finalUrl,
        ...(mode === "manual" && manual.brandName.trim() ? { name: manual.brandName.trim() } : {}),
        onboarded_at: new Date().toISOString(),
      })
      .eq("id", workspaceId);
    if (error) {
      setSaving(false);
      toast.error("Couldn't skip setup", { description: "Your URL is still saved. Try again." });
      return;
    }
    saveBrandDnaFor(workspaceId, { ...currentDna(), status: "idle", extractedAt: null }, true);
    try {
      localStorage.removeItem(urlKey(workspaceId));
      localStorage.removeItem(manualKey(workspaceId));
    } catch {
      /* storage unavailable */
    }
    setSaving(false);
    // Onboarding is done: Back must never lead into it again.
    navigate({ to: workspacePath(workspaceId), replace: true });
  };

  // Going in plays the VR entry (VisorTransition); the app builds in behind
  // its flash and, on Home, opens "Start here" once.
  const [entering, setEntering] = useState<string | null>(null);
  const enterApp = (target = workspacePath(workspace.id)) => {
    if (entering) return;
    setEntering(target);
  };
  const finishEntering = () => {
    if (!entering) return;
    markEntryBloom();
    try {
      if (entering === workspacePath(workspace.id))
        sessionStorage.setItem("mox:entered", workspace.id);
    } catch {
      /* storage unavailable */
    }
    navigate({ to: entering, replace: true });
  };

  const centered = step === "website" || step === "scan";
  const stepMotion = {
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 14 },
    animate: { opacity: 1, y: 0, transition: { duration: duration.xslow, ease: ease.emphasized } },
    exit: { opacity: 0, transition: { duration: duration.base, ease: ease.accelerate } },
  };

  // Wait until the route's workspace and any saved scan URL are restored.
  // Otherwise the empty URL form flashes for a frame before recovery switches
  // returning users straight back to the scan.
  if (!workspaceId) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background text-foreground">
        <Logo markOnly height={34} />
        <span
          aria-label="Preparing your workspace"
          className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary"
        />
        <span className="sr-only">Preparing your workspace</span>
      </div>
    );
  }

  const scanStrip =
    mode === "site" && websiteUrl ? (
      <ScanStrip
        url={websiteUrl}
        status={scanStatus}
        progress={progress}
        phase={phase}
        discoveries={discoveries}
        reduce={reduce}
        onRetry={() => void runScan(websiteUrl)}
      />
    ) : undefined;

  return (
    // Mellox 2.0: onboarding sits in the same white window on Mox's backdrop
    // as the app, with a gradient progress line at the top (Holo's layout).
    <div
      data-mellox-app
      className="ds-backdrop relative flex min-h-[100dvh] flex-col lg:p-[var(--ds-frame-inset)]"
    >
      <div className="ds-frame relative flex min-h-[calc(100dvh-2*var(--ds-frame-inset))] flex-1 flex-col overflow-x-clip text-foreground max-lg:min-h-[100dvh] max-lg:rounded-none">
        <div aria-hidden className="ds-aurora pointer-events-none absolute inset-0" />
        <AmbientCanvas />
        {/* The finish is Mox alone, full screen (Holo): no logo or progress. */}
        <header
          className={`relative z-10 grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 sm:px-6 ${step === "first" ? "hidden" : ""}`}
        >
          <span className="sm:hidden">
            <Logo markOnly height={28} />
          </span>
          <span className="hidden sm:block">
            <Logo height={30} />
          </span>
          <StepIndicator mode={mode} step={step} />
          <div className="justify-self-end">
            {step !== "done" && step !== "channels" && step !== "first" && (
              <button
                type="button"
                onClick={() => void skip()}
                disabled={saving}
                className="inline-flex h-8 items-center rounded-full px-3 text-[12px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                {saving ? (
                  <>
                    <Spinner className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden /> Saving…
                  </>
                ) : (
                  "Skip for now"
                )}
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
                      onSubmit={() => {
                        setMode("site");
                        setStep("goals");
                        void runScan(websiteUrl);
                      }}
                      onNoWebsite={() => {
                        scanAbort.current?.abort();
                        setWebsiteUrl("");
                        setMode("manual");
                        setStep("manual");
                      }}
                    />
                  )}
                  {step === "manual" && (
                    <ManualBrandStep
                      value={manual}
                      part={manualPart}
                      inspirations={inspiration.items}
                      reduce={reduce}
                      headingRef={headingRef}
                      onChange={(patch) => setManual((m) => ({ ...m, ...patch }))}
                      onPart={setManualPart}
                      onAddInspoFiles={inspiration.addFiles}
                      onAddInspoLink={inspiration.addLink}
                      onRemoveInspo={(key) => void inspiration.remove(key)}
                      onRetryInspo={inspiration.retry}
                      onHaveWebsite={() => {
                        setMode("site");
                        setStep("website");
                      }}
                      onDone={() => go("manual")}
                    />
                  )}
                  {step === "goals" && (
                    <GoalStep
                      draft={goalDraft}
                      saving={goalSaving}
                      error={goalError}
                      warnings={goalWarnings}
                      reduce={reduce}
                      headingRef={headingRef}
                      scanStrip={scanStrip}
                      onChange={(patch) => {
                        setGoalError(null);
                        setGoalDraft((d) => ({ ...d, ...patch }));
                      }}
                      onBack={() => back("goals")}
                      onContinue={() => void submitGoals()}
                    />
                  )}
                  {step === "scan" && (
                    <ScanStage
                      url={websiteUrl}
                      status={scanStatus}
                      progress={progress}
                      phase={phase}
                      discoveries={discoveries}
                      competitors={competitors}
                      competitorResearchStatus={competitorResearchStatus}
                      error={scanError}
                      reduce={reduce}
                      headingRef={headingRef}
                      onRetry={() => void runScan(websiteUrl)}
                      onEdit={() => setStep("website")}
                      onSkip={() => {
                        // No usable scan: carry on by hand from the brand questions.
                        scanAbort.current?.abort();
                        setMode("manual");
                        setStep("manual");
                      }}
                    />
                  )}
                  {step === "review" && (
                    <BrandReveal
                      brand={brand}
                      competitors={competitors}
                      competitorResearchStatus={competitorResearchStatus}
                      url={websiteUrl}
                      saving={saving}
                      reduce={reduce}
                      headingRef={headingRef}
                      onChange={(patch) => setEdits((current) => ({ ...current, ...patch }))}
                      onContinue={() => void continueFromReview()}
                      onRescan={rescan}
                      onChangeUrl={() => setStep("website")}
                    />
                  )}
                  {step === "language" && (
                    <LanguageStep
                      value={language}
                      saving={saving}
                      headingRef={headingRef}
                      onChange={setLanguage}
                      onBack={() => back("language")}
                      onContinue={() => void continueFromLanguage()}
                    />
                  )}
                  {step === "products" && (
                    <ProductsStep
                      brandName={brandName}
                      defaultKind={
                        mode === "manual" && manual.sells === "services" ? "service" : "product"
                      }
                      siteHost={mode === "site" && websiteUrl ? hostOf(websiteUrl) : null}
                      scanning={mode === "site" && scanStatus === "loading"}
                      incoming={catalogue.incoming}
                      failed={catalogue.failed}
                      products={catalogue.products}
                      loading={catalogue.loading}
                      busy={catalogue.busy}
                      lowResolution={catalogue.lowResolution}
                      adding={catalogue.adding}
                      error={catalogue.error}
                      blockedReason={
                        saving
                          ? "Saving…"
                          : !catalogue.products.length && catalogue.incoming.length
                            ? "Adding what we found on your site…"
                            : blockedReason("products", flow)
                      }
                      reduce={reduce}
                      headingRef={headingRef}
                      onRetry={catalogue.retryFailed}
                      onRemoveFound={() => void catalogue.removeFound()}
                      onAdd={(d) => void catalogue.add(d)}
                      onSave={(id, d) => void catalogue.save(id, d)}
                      onArchive={(id) => void catalogue.archive(id)}
                      onUpload={(id, file) => void catalogue.upload(id, file)}
                      onPrimary={(id, assetId) => void catalogue.setPrimary(id, assetId)}
                      onBack={() => back("products")}
                      onContinue={() => void finishSetup()}
                    />
                  )}
                  {step === "channels" && (
                    <ChannelsStep
                      connectedCount={connected.length}
                      headingRef={headingRef}
                      onBack={() => back("channels")}
                      onContinue={() => go("channels")}
                    >
                      <SocialAccountsSection
                        variant="onboarding"
                        onConnectedChange={setConnected}
                      />
                    </ChannelsStep>
                  )}
                  {step === "first" && (
                    <FinishStep
                      brandName={brandName}
                      language={language}
                      products={catalogue.products.length}
                      channels={connected.length}
                      reduce={reduce}
                      headingRef={headingRef}
                      onBack={() => back("first")}
                      onEnter={() => enterApp()}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </LayoutGroup>
          </div>
        </main>
      </div>
      {entering && <VisorTransition reduced={reduce} onCovered={finishEntering} />}
    </div>
  );
}

function StepIndicator({ mode, step }: { mode: FlowMode; step: Step }) {
  const steps = indicatorSteps(mode);
  const current = indicatorIndex(mode, step);
  // Holo's progress line: one gradient bar, with the step name under it.
  const value = Math.min(1, (current + 0.5) / steps.length);
  return (
    <div className="flex w-[168px] flex-col items-center gap-1.5 sm:w-[300px]">
      <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
        <motion.div
          className="ds-grad-bar h-full rounded-full"
          initial={false}
          animate={{ width: `${value * 100}%` }}
          transition={{ type: "spring", stiffness: 140, damping: 24 }}
        />
      </div>
      <span className="text-[11px] font-semibold text-muted-foreground">
        {steps[current] ? `${current + 1} of ${steps.length} · ${steps[current].label}` : "Done"}
      </span>
      <StepList steps={steps} current={current} />
    </div>
  );
}

/** The steps for screen readers; the bar above is what people see. */
function StepList({
  steps,
  current,
}: {
  steps: ReturnType<typeof indicatorSteps>;
  current: number;
}) {
  return (
    <ol aria-label="Setup progress" className="sr-only">
      {steps.map((item, index) => (
        <li key={item.id} aria-current={index === current ? "step" : undefined}>
          {item.label}
          {index < current ? " (complete)" : ""}
        </li>
      ))}
    </ol>
  );
}

export default Onboarding;

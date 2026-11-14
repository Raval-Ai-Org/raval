"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LayoutGroup } from "framer-motion";
import { toast } from "@/lib/toast";
import { Logo } from "@/components/brand/Logo";
import type { BrandEdits } from "@/components/onboarding/BrandReveal";
import { SCAN_PHASES, advancePhase } from "@/components/onboarding/phases";
import { ScanStage, type ScanProgress, type ScanStatus } from "@/components/onboarding/ScanStage";
import type { CompetitorResearchStatus } from "@/components/onboarding/CompetitorResearchPreview";
import { UrlStep } from "@/components/onboarding/UrlStep";
import {
  ManualBrandStep,
  emptyManualBrand,
  type ManualBrand,
} from "@/components/onboarding/ManualBrandStep";
import { useManualInspiration } from "@/components/onboarding/manual/use-manual-inspiration";
import { manualDnaFields, readManualDraft, type ManualPart } from "@/lib/onboarding/manual-brand";
import { ProductsStep } from "@/components/onboarding/ProductsStep";
import { browserContentLanguage } from "@/components/onboarding/LanguageStep";
import { withLanguage } from "@/lib/brand-look/languages";
import { tidyLook } from "@/lib/inspo/look";
import { VisorTransition, markEntryBloom } from "@/components/brand/mox/VisorTransition";
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
import { bootstrapCompetitors, type CompetitorView } from "@/lib/competitors.functions";
import { getGoals, saveGoals } from "@/lib/goals.functions";
import type { WorkspaceGoals } from "@/lib/goals/contracts";
import {
  blockedReason,
  nextStep,
  previousStep,
  progressOf,
  screensLeft,
  type FlowMode,
  type FlowState,
  type OnboardingStep,
} from "@/lib/onboarding/flow";
import {
  answersToGoals,
  answersToLook,
  answersToProfile,
  readAnswers,
  type Answers,
  type OnboardingChannel,
  type Role,
} from "@/lib/onboarding/answers";
import { askScreens, minutesLeft, type AskScreen } from "@/lib/onboarding/questions";
import { onboardingArt } from "@/lib/onboarding/art";
import { productsSummary } from "@/lib/products/catalog";
import { readBrandExtractStream } from "@/lib/brand-extract-stream";
import { useNavigate } from "@/lib/navigation";
import { Stage, type StageAction, type StageScene } from "@/components/onboarding/ask/Stage";
import { ScanDock } from "@/components/onboarding/ask/ScanDock";
import { PickScreen } from "@/components/onboarding/ask/PickScreen";
import { SayScreen } from "@/components/onboarding/ask/SayScreen";
import { ChannelsScreen } from "@/components/onboarding/ask/ChannelsScreen";
import { LookSwipe, LOOK_MIN_SWIPES } from "@/components/onboarding/ask/LookSwipe";
import {
  AnswerTrail,
  AudiencePick,
  BrandCard,
  ConnectStep,
  LanguagePick,
  type Learned,
} from "@/components/onboarding/ask/AfterSteps";
import { DoneStep } from "@/components/onboarding/ask/DoneStep";

type Step = OnboardingStep;

/** workspaces_owner_domain_unique: this owner already has the brand's domain. */
function isDuplicateDomainError(error: { code?: string; message?: string } | null): boolean {
  return Boolean(
    error && (error.code === "23505" || /workspaces_owner_domain_unique/.test(error.message ?? "")),
  );
}

/** Hold on the completed scan so the final phase visibly lands before the reveal. */
const COMPLETE_BEAT_MS = 700;

const IDLE_PROGRESS: ScanProgress = { stage: "idle", message: "", pct: 0 };

/** The role answer as the account's persona (set once, first writer wins). */
const ROLE_PERSONA: Record<Role, "agency" | "founder" | "professional"> = {
  agency: "agency",
  owner: "founder",
  creator: "founder",
  marketing: "professional",
};

const STEP_ORDER: Step[] = [
  "website",
  "manual",
  "ask",
  "scan",
  "review",
  "audience",
  "products",
  "language",
  "connect",
  "first",
  "done",
];

const APPROVAL_LINE = {
  autopilot: "you approve each post",
  assist: "you approve the plan and each post",
  full: "fully automatic, anything unsure waits for you",
} as const;

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
  // The brand's content language (Mellox 2.0): what Mox writes in.
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
  const [goals, setGoals] = useState<WorkspaceGoals | null>(null);
  const [connected, setConnected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // One question per screen (ADR-0049): the answers and where the person is.
  const [answers, setAnswers] = useState<Answers>({});
  const [askIndex, setAskIndex] = useState(0);
  const [sourceKnown, setSourceKnown] = useState(true);
  const [flash, setFlash] = useState(0);
  const [audience, setAudience] = useState<string[] | null>(null);
  const userId = useRef<string | null>(null);
  const scanFor = useRef<string | null>(null);
  const resultFor = useRef<string | null>(null);
  const scanAbort = useRef<AbortController | null>(null);
  const competitorRun = useRef<Promise<void> | null>(null);
  const competitorFor = useRef<string | null>(null);
  const competitorGeneration = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStep = useRef(true);

  const urlKey = (id: string) => `onboarding:website:${id}`;
  // A finished scan survives a refresh (this browser only), so a reload never
  // pays for the same site twice.
  const scanKey = (id: string) => `onboarding:scan:${id}`;
  const manualKey = (id: string) => `onboarding:manual:${id}`;
  const answersKey = (id: string) => `onboarding:answers:${id}`;
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
  // What the scan finds is kept as it arrives, while the person answers.
  const { autoKeep } = catalogue;
  useEffect(() => {
    if (mode === "site" && candidates.length) autoKeep(candidates);
  }, [mode, candidates, autoKeep]);

  const audienceOptions = useMemo(
    () => (mode === "site" ? (result?.audienceTags ?? []).filter(Boolean).slice(0, 4) : []),
    [mode, result?.audienceTags],
  );
  // The scan's groups start picked; the person removes what's wrong.
  useEffect(() => {
    if (audience === null && audienceOptions.length) setAudience(audienceOptions);
  }, [audience, audienceOptions]);

  const flow: FlowState = {
    mode,
    scan: scanStatus,
    goalsSaved: Boolean(goals),
    activeProducts: catalogue.products.length,
    audienceOptions: audienceOptions.length,
  };

  const screens = useMemo(
    () => askScreens(answers, { mode, sourceKnown }),
    [answers, mode, sourceKnown],
  );
  const index = Math.min(askIndex, screens.length - 1);
  const screen: AskScreen = screens[index];

  // Screens slide the way the person is going (forward or back).
  const position = STEP_ORDER.indexOf(step) * 1000 + (step === "ask" ? index : 0);
  const [nav, setNav] = useState({ position, direction: 1 as 1 | -1 });
  if (nav.position !== position) setNav({ position, direction: position > nav.position ? 1 : -1 });

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
    // Answers given before a refresh are kept, and so is the screen.
    try {
      const kept = JSON.parse(localStorage.getItem(answersKey(workspace.id)) || "null") as {
        answers?: unknown;
        index?: unknown;
      } | null;
      if (kept) {
        setAnswers(readAnswers(kept.answers));
        if (typeof kept.index === "number" && kept.index >= 0) setAskIndex(Math.floor(kept.index));
      }
    } catch {
      /* nothing kept */
    }
    if (recovered) {
      setWebsiteUrl(recovered);
      setStep("ask");
    } else if (draft) {
      setManual(draft);
      setMode("manual");
      setStep("manual");
    } else if (new URLSearchParams(window.location.search).get("start") === "manual") {
      setMode("manual");
      setStep("manual");
    }
    void getGoals({ data: { workspaceId: workspace.id } })
      .then((view) => {
        if (view.goals) setGoals(view.goals);
      })
      .catch(() => undefined);
    // "Where did you hear of Mellox?" is asked once per account.
    void (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id ?? null;
      userId.current = uid;
      if (!uid) return;
      const { data, error } = await supabase
        .from("profiles")
        .select("signup_source")
        .eq("id", uid)
        .maybeSingle();
      if (!error && data && !data.signup_source) setSourceKnown(false);
    })().catch(() => undefined);
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

  useEffect(() => {
    if (!workspaceId) return;
    try {
      localStorage.setItem(answersKey(workspaceId), JSON.stringify({ answers, index: askIndex }));
    } catch {
      /* storage unavailable */
    }
  }, [workspaceId, answers, askIndex]);

  // Each new screen moves focus to its heading, so keyboard and screen-reader
  // users land on the new content instead of a control that no longer exists.
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    const timer = window.setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 80);
    return () => window.clearTimeout(timer);
  }, [step, askIndex, manualPart]);

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

  /** Scan the site in the background while the person answers. */
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

      if (resultFor.current !== url) setEdits({});
      resultFor.current = url;
      setResult(outcome.result);
      try {
        localStorage.setItem(scanKey(workspaceId), JSON.stringify({ url, result: outcome.result }));
      } catch {
        /* storage unavailable or full: a refresh scans again */
      }
      setProgress({ stage: "done", message: "Brand DNA is ready to review", pct: 100 });
      setPhase(SCAN_PHASES.length - 1);
      setScanStatus("ok");
      if (stepRef.current === "scan") {
        if (!reduce) await new Promise((resolve) => window.setTimeout(resolve, COMPLETE_BEAT_MS));
        if (!controller.signal.aborted && stepRef.current === "scan") setStep("review");
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      // One automatic retry; after that "Try again" is a person's click.
      if (attempt < 1) {
        setProgress({
          stage: "retry",
          message: "The connection took longer than expected. Trying once more…",
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

  // Recovery after a refresh: the scan this browser kept is restored; only a
  // scan that never finished is run again, once.
  useEffect(() => {
    if (mode !== "site" || !workspaceId || !websiteUrl || scanStatus !== "idle") return;
    if (step === "website") return;
    try {
      const kept = JSON.parse(localStorage.getItem(scanKey(workspaceId)) || "null") as {
        url?: string;
        result?: BrandExtractResult;
      } | null;
      if (kept?.result && kept.url === normalizeUrl(websiteUrl)) {
        scanFor.current = kept.url;
        resultFor.current = kept.url;
        setResult(kept.result);
        setProgress({ stage: "done", message: "Brand DNA is ready to review", pct: 100 });
        setPhase(SCAN_PHASES.length - 1);
        setScanStatus("ok");
        return;
      }
    } catch {
      /* nothing kept: scan */
    }
    void runScan(websiteUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, workspaceId, websiteUrl, scanStatus, mode]);

  const go = (from: Step, state: FlowState = flow) => setStep(nextStep(from, state));

  /** The Brand DNA as it stands: scan + edits (or the manual kit) + the answers. */
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
    const picked = (audience ?? []).filter(Boolean);
    return {
      ...base,
      // Every answer reaches the generators through the look (styleBlockFor)
      // and the profile ("Who runs it"); a value the person set wins.
      look: tidyLook(withLanguage(answersToLook(answers, base.look), language)),
      profile: answersToProfile(answers, base.profile),
      ...(picked.length ? { audienceTags: picked } : {}),
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

  /** The goal from the answers, through decideGoals on the server. */
  const persistGoals = async (a: Answers = answers): Promise<WorkspaceGoals | null> => {
    if (!workspaceId) return null;
    const raw = answersToGoals(a, goals);
    if (!raw) return goals;
    try {
      const saved = await saveGoals({ data: { workspaceId, goals: raw } });
      if (saved.goals) setGoals(saved.goals);
      return saved.goals ?? goals;
    } catch (error) {
      toast.error("Couldn't save your goal", {
        description: error instanceof Error ? error.message : "Try again in a moment.",
      });
      return null;
    }
  };

  /* ── The questions ─────────────────────────────────────────────────── */

  const leaveAsk = async (a: Answers = answers) => {
    if (saving) return;
    setSaving(true);
    const saved = await persistGoals(a);
    setSaving(false);
    if (!saved) {
      // No goal yet: back to the goal question.
      const focusAt = screens.findIndex((s) => s.id === "focus");
      if (!a.focus && focusAt >= 0) setAskIndex(focusAt);
      return;
    }
    go("ask", { ...flow, goalsSaved: true });
  };

  const nextAsk = (a: Answers = answers) => {
    const list = askScreens(a, { mode, sourceKnown });
    if (index >= list.length - 1) {
      void leaveAsk(a);
      return;
    }
    setAskIndex(index + 1);
  };

  const pick = (id: string, value: string | number) => {
    const next = { ...answers, [id]: value } as Answers;
    setAnswers(next);
    setFlash((n) => n + 1);
    if (id === "role") {
      void supabase
        .rpc("set_persona_once", { _persona: ROLE_PERSONA[value as Role] })
        .then(() => undefined);
    }
    if (id === "source" && userId.current) {
      void supabase
        .from("profiles")
        .update({ signup_source: String(value) })
        .eq("id", userId.current)
        .is("signup_source", null)
        .then(() => undefined);
    }
    nextAsk(next);
  };

  const continueAsk = () => {
    if (screen.kind === "channels") {
      setFlash((n) => n + 1);
      // The goal is saved as soon as its parts are in, so a refresh keeps it.
      void persistGoals();
    }
    nextAsk();
  };

  /* ── After the questions ───────────────────────────────────────────── */

  const continueWithSave = async (from: Step) => {
    if (saving) return;
    setSaving(true);
    const ok = await saveDna();
    setSaving(false);
    if (ok) go(from);
  };

  /** The essentials are in: mark the workspace set up. Connecting is an extra. */
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
        description: "Your answers are still here. Try again.",
      });
      return;
    }
    const ok = await saveDna();
    setSaving(false);
    if (!ok) return;
    try {
      localStorage.removeItem(urlKey(workspaceId));
      localStorage.removeItem(scanKey(workspaceId));
      localStorage.removeItem(manualKey(workspaceId));
      localStorage.removeItem(answersKey(workspaceId));
    } catch {
      /* storage unavailable */
    }
    if (mode === "manual" && manual.competitors.length) {
      // The competitors typed in are on Brand DNA; the included first research
      // lifts them into Brain → Competitors. A plan without tracking skips it.
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
    go("language");
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
    // What was answered is still used, even when the rest is skipped.
    if (answers.focus) await persistGoals();
    saveBrandDnaFor(workspaceId, { ...currentDna(), status: "idle", extractedAt: null }, true);
    try {
      localStorage.removeItem(urlKey(workspaceId));
      localStorage.removeItem(manualKey(workspaceId));
      localStorage.removeItem(answersKey(workspaceId));
    } catch {
      /* storage unavailable */
    }
    setSaving(false);
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

  /* ── Back, and the primary action of each screen ───────────────────── */

  const back = (): (() => void) | null => {
    if (step === "ask" && index > 0) return () => setAskIndex(index - 1);
    if (step === "first") return () => setStep("connect");
    const prev = previousStep(step, flow);
    if (!prev) return null;
    return () => {
      if (prev === "ask") setAskIndex(screens.length - 1);
      setStep(prev);
    };
  };

  const action: StageAction | null = (() => {
    switch (step) {
      case "ask":
        if (screen.kind === "say" || screen.kind === "channels")
          return { label: "Continue", onClick: continueAsk, busy: saving };
        if (screen.kind === "swipe") {
          const swiped = (answers.likes?.length ?? 0) + (answers.skips?.length ?? 0);
          return swiped >= LOOK_MIN_SWIPES
            ? { label: "Continue", onClick: continueAsk }
            : { label: "Skip", quiet: true, onClick: continueAsk };
        }
        // A pick answers with a tap; going back to one keeps its answer.
        return answers[screen.id] !== undefined
          ? { label: "Keep it", quiet: true, onClick: () => nextAsk(), busy: saving }
          : null;
      case "review":
        return {
          label: "Looks right",
          onClick: () => void continueWithSave("review"),
          busy: saving,
        };
      case "audience":
        return {
          label: "Continue",
          onClick: () => void continueWithSave("audience"),
          busy: saving,
        };
      case "products": {
        const hint =
          !catalogue.products.length && catalogue.incoming.length
            ? "Adding what we found on your site…"
            : blockedReason("products", flow);
        return {
          label: "Continue",
          onClick: () => void continueWithSave("products"),
          disabled: Boolean(hint),
          busy: saving,
          hint,
        };
      }
      case "language":
        return { label: "Continue", onClick: () => void finishSetup(), busy: saving };
      case "connect":
        return connected.length
          ? { label: "Continue", onClick: () => go("connect") }
          : { label: "Later", quiet: true, onClick: () => go("connect") };
      default:
        return null;
    }
  })();

  // Space / Enter / → move on, ← goes back. Digits are the pick screen's;
  // the swipe deck takes ←/→ for itself.
  const keyRef = useRef<{ action: StageAction | null; back: (() => void) | null }>({
    action: null,
    back: null,
  });
  keyRef.current = { action, back: back() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable],button,a,[role=radio],[role=button]"))
        return;
      const { action: a, back: b } = keyRef.current;
      if (
        (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") &&
        a &&
        !a.disabled &&
        !a.busy
      ) {
        e.preventDefault();
        a.onClick();
      } else if (e.key === "ArrowLeft" && b) {
        e.preventDefault();
        b();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Wait until the route's workspace and any saved scan URL are restored.
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

  const askCount = { index, count: screens.length };
  const scene: StageScene = step === "website" ? "world" : step === "first" ? "finish" : "wash";
  const showDock =
    mode === "site" &&
    Boolean(websiteUrl) &&
    step !== "website" &&
    step !== "scan" &&
    step !== "first";

  const trail =
    step === "ask"
      ? screens.slice(0, index).flatMap((s) => {
          if (s.kind !== "pick") return [];
          const value = answers[s.id];
          const o = s.options.find((x) => x.value === value);
          if (!o) return [];
          const src = o.art.kind === "image" ? onboardingArt(o.art.id) : null;
          return [
            {
              id: s.id,
              label: o.label,
              art: src ? <img src={src} alt="" className="size-full object-cover" /> : undefined,
            },
          ];
        })
      : [];

  const learned: Learned = {
    brand: [answers.tone && answers.tone !== "auto" ? `${answers.tone} tone` : null, language]
      .filter(Boolean)
      .join(" · "),
    audience: (audience ?? [])[0] || brand.audience?.slice(0, 40) || undefined,
    competitors: competitors.length
      ? `${competitors.length} ${competitors.length === 1 ? "rival" : "rivals"} found`
      : undefined,
    market: brand.industry?.slice(0, 40) || undefined,
  };
  const rhythm = goals?.postsPerWeek ?? answers.rhythm;
  const plan = [
    rhythm ? `${rhythm} ${rhythm === 1 ? "post" : "posts"} a week` : null,
    answers.approval ? APPROVAL_LINE[answers.approval] : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const screenKey =
    step === "ask" ? `ask:${screen.id}` : step === "manual" ? `manual:${manualPart}` : step;

  return (
    <>
      <LayoutGroup>
        <Stage
          scene={scene}
          progress={progressOf(step, askCount, mode)}
          minutes={step === "first" ? null : minutesLeft(screensLeft(step, askCount, flow))}
          hideHeader={step === "first"}
          trail={<AnswerTrail chips={trail} reduce={reduce} />}
          screenKey={screenKey}
          reduce={reduce}
          onBack={step === "website" || step === "first" ? null : back()}
          onSkip={step === "first" || step === "connect" ? null : () => void skip()}
          skipping={saving}
          action={action}
          direction={nav.direction}
          scan={
            showDock ? (
              <ScanDock
                url={websiteUrl}
                status={scanStatus}
                pct={progress.pct}
                phase={phase}
                message={scanStatus === "loading" ? progress.message : undefined}
                discoveries={discoveries}
                flash={flash}
                reduce={reduce}
                onRetry={() => void runScan(websiteUrl)}
              />
            ) : null
          }
        >
          {step === "website" && (
            <div className="ob-scene-content" data-side="right">
              <div className="ob-scene-panel ob-glass rounded-[32px] p-5 sm:p-7">
                <UrlStep
                  value={websiteUrl}
                  reduce={reduce}
                  headingRef={headingRef}
                  onChange={setWebsiteUrl}
                  onSubmit={() => {
                    setMode("site");
                    setAskIndex(0);
                    setStep("ask");
                    void runScan(websiteUrl);
                  }}
                  onNoWebsite={() => {
                    scanAbort.current?.abort();
                    setWebsiteUrl("");
                    setMode("manual");
                    setStep("manual");
                  }}
                />
              </div>
            </div>
          )}
          {step === "manual" && (
            <div className="h-full overflow-y-auto overscroll-contain px-1 pb-4">
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
                onDone={() => {
                  setAskIndex(0);
                  go("manual");
                }}
              />
            </div>
          )}
          {step === "ask" && screen.kind === "say" && (
            <SayScreen
              screen={screen}
              reduce={reduce}
              headingRef={headingRef}
              onNext={continueAsk}
            />
          )}
          {step === "ask" && screen.kind === "pick" && (
            <PickScreen
              screen={screen}
              value={answers[screen.id]}
              reduce={reduce}
              headingRef={headingRef}
              onPick={(v) => pick(screen.id, v)}
            />
          )}
          {step === "ask" && screen.kind === "channels" && (
            <ChannelsScreen
              screen={screen}
              value={answers.channels ?? []}
              reduce={reduce}
              headingRef={headingRef}
              onChange={(channels: OnboardingChannel[]) => setAnswers((a) => ({ ...a, channels }))}
            />
          )}
          {step === "ask" && screen.kind === "swipe" && (
            <LookSwipe
              screen={screen}
              likes={answers.likes ?? []}
              skips={answers.skips ?? []}
              reduce={reduce}
              headingRef={headingRef}
              onSwipe={(id, liked) =>
                setAnswers((a) => ({
                  ...a,
                  likes: liked ? [...(a.likes ?? []), id] : (a.likes ?? []),
                  skips: liked ? (a.skips ?? []) : [...(a.skips ?? []), id],
                }))
              }
              onDone={() => nextAsk()}
            />
          )}
          {step === "scan" && (
            <div className="grid h-full place-items-center overflow-y-auto">
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
                  // No usable scan: carry on by hand from the brand kit.
                  scanAbort.current?.abort();
                  setMode("manual");
                  setStep("manual");
                }}
              />
            </div>
          )}
          {step === "review" && (
            <BrandCard
              brand={brand}
              url={websiteUrl}
              reduce={reduce}
              headingRef={headingRef}
              onChange={(patch) => setEdits((current) => ({ ...current, ...patch }))}
            />
          )}
          {step === "audience" && (
            <AudiencePick
              options={audienceOptions}
              value={audience ?? []}
              reduce={reduce}
              headingRef={headingRef}
              onChange={setAudience}
            />
          )}
          {step === "products" && (
            <div className="h-full overflow-y-auto overscroll-contain px-1 pb-4">
              <div className="mx-auto max-w-5xl">
                <ProductsStep
                  embedded
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
                  blockedReason={blockedReason("products", flow)}
                  reduce={reduce}
                  headingRef={headingRef}
                  onRetry={catalogue.retryFailed}
                  onRemoveFound={() => void catalogue.removeFound()}
                  onAdd={(d) => void catalogue.add(d)}
                  onSave={(id, d) => void catalogue.save(id, d)}
                  onArchive={(id) => void catalogue.archive(id)}
                  onUpload={(id, file) => void catalogue.upload(id, file)}
                  onPrimary={(id, assetId) => void catalogue.setPrimary(id, assetId)}
                  onBack={() => back()?.()}
                  onContinue={() => void continueWithSave("products")}
                />
              </div>
            </div>
          )}
          {step === "language" && (
            <LanguagePick
              value={language}
              reduce={reduce}
              headingRef={headingRef}
              onChange={setLanguage}
            />
          )}
          {step === "connect" && (
            <ConnectStep reduce={reduce} headingRef={headingRef}>
              <SocialAccountsSection variant="onboarding" onConnectedChange={setConnected} />
            </ConnectStep>
          )}
          {step === "first" && (
            <DoneStep
              brandName={brandName}
              learned={learned}
              plan={plan || null}
              reduce={reduce}
              headingRef={headingRef}
              onEnter={() => enterApp()}
            />
          )}
        </Stage>
      </LayoutGroup>
      {entering && <VisorTransition reduced={reduce} onCovered={finishEntering} />}
    </>
  );
}

export default Onboarding;

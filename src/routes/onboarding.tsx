import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowUp, ArrowRight, ArrowLeft, Sparkles, Globe, Github, Loader2,
  Check, SkipForward, Search, FileText, Share2, Wand2, X, Plus, RefreshCw,
  Target, Users, Megaphone, Building2,
} from "@/components/ui/gemini-icons";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";
import { BASE_URL } from "@/lib/seo";
import { toast } from "sonner";
import { Logo } from "@/components/brand/Logo";
import { StarAgent, type StarMood } from "@/components/StarAgent";
import { emptyDna, type BrandDna } from "@/hooks/use-brand-dna";
import { buildDesignMd, saveDesignMd } from "@/lib/design-md";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  beforeLoad: async ({ location }) => {
    const { redirect } = await import("@tanstack/react-router");
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { next: location.href } as any });
    }
  },
  component: Onboarding,
  head: () => ({
    meta: [
      { title: "Onboard a client · Raval AI" },
      { name: "description", content: "Add a new brand to your Raval AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content." },
      { name: "robots", content: "noindex,nofollow" },
      { property: "og:title", content: "Onboard a client · Raval AI" },
      { property: "og:description", content: "Add a new brand to your Raval AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content." },
      { property: "og:url", content: `${BASE_URL}/onboarding` },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Onboard a client · Raval AI" },
      { name: "twitter:description", content: "Add a new brand to your Raval AI workspace and let Ravi build its Brand DNA, AEO/GEO baseline and first week of content." },
    ],
    links: [{ rel: "canonical", href: `${BASE_URL}/onboarding` }],
  }),
});

type Step = "prompt" | "website" | "extract" | "review" | "personalize" | "connect" | "analyze" | "done";

const PROMPT_SUGGESTIONS = [
  { label: "Get cited by ChatGPT & Perplexity", icon: Search },
  { label: "Plan this month's content", icon: FileText },
  { label: "Grow on LinkedIn this month", icon: Share2 },
];

const KPI_OPTIONS = ["Organic traffic", "Pipeline / Leads", "Signups", "Revenue", "Brand awareness", "Community growth"];
const CADENCE_OPTIONS = ["Daily", "3× / week", "Weekly", "Bi-weekly", "Ad-hoc"];
const PLATFORM_OPTIONS = ["LinkedIn", "X / Twitter", "Instagram", "TikTok", "YouTube", "Blog", "Newsletter", "Reddit"];

function normalizeUrl(raw: string) {
  const t = raw.trim();
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function Onboarding() {
  const navigate = useNavigate();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("prompt");
  const [saving, setSaving] = useState(false);
  const [hasPresetWebsite, setHasPresetWebsite] = useState(false);

  // Form state
  const [firstPrompt, setFirstPrompt] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [provider, setProvider] = useState<"github" | "wordpress" | "none" | "">("");

  // Extracted + editable brand fields (seeded by /api/brand-extract)
  const [brand, setBrand] = useState<Partial<BrandDna>>({});
  const [extractStatus, setExtractStatus] = useState<"idle" | "loading" | "ok" | "error" | "skipped">("idle");
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extractProgress, setExtractProgress] = useState<{ stage: string; message: string; pct: number }>({ stage: "idle", message: "", pct: 0 });
  const extractRanFor = useRef<string | null>(null);

  // Personalization
  const [goals, setGoals] = useState("");
  const [primaryKpis, setPrimaryKpis] = useState<string[]>([]);
  const [cadence, setCadence] = useState<string>("");
  const [platforms, setPlatforms] = useState<string[]>([]);
  const [competitorsText, setCompetitorsText] = useState("");
  const [voiceTone, setVoiceTone] = useState<string[]>([]);
  const [doRules, setDoRules] = useState("");
  const [dontRules, setDontRules] = useState("");

  const visibleSteps = useMemo<Step[]>(() => {
    const base: Step[] = ["prompt", "website"];
    if (websiteUrl.trim() || hasPresetWebsite) base.push("extract", "review");
    base.push("personalize", "connect", "analyze", "done");
    return base;
  }, [websiteUrl, hasPresetWebsite]);

  // Boot — check session and workspace
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) { navigate({ to: "/login" }); return; }
      const selectedId = typeof window !== "undefined" ? localStorage.getItem("workspace:selected") : null;
      const query = supabase.from("workspaces").select("id, onboarded_at, website_url");
      const { data: ws } = selectedId
        ? await query.eq("id", selectedId).maybeSingle()
        : await query.order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (cancelled) return;
      if (!ws?.id) { navigate({ to: "/projects" }); return; }
      if (ws.onboarded_at) { navigate({ to: "/app" }); return; }
      localStorage.setItem("workspace:selected", ws.id);
      setWorkspaceId(ws.id);
      if (ws.website_url) {
        setWebsiteUrl(ws.website_url);
        setHasPresetWebsite(true);
      }
    })();
    return () => { cancelled = true; };
  }, [navigate]);

  const idx = visibleSteps.indexOf(step);
  const progress = ((idx + 1) / visibleSteps.length) * 100;

  const canNext = useMemo(() => {
    if (step === "prompt")  return firstPrompt.trim().length >= 4;
    if (step === "website") {
      const v = websiteUrl.trim();
      if (v === "") return true;
      return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(v);
    }
    if (step === "extract") return extractStatus === "ok" || extractStatus === "skipped" || extractStatus === "error";
    if (step === "review") return true;
    if (step === "personalize") return true;
    if (step === "connect") return provider !== "";
    return true;
  }, [step, firstPrompt, websiteUrl, extractStatus, provider]);

  const goNext = () => {
    const next = visibleSteps[idx + 1];
    if (next) setStep(next);
  };
  const goBack = () => {
    const prev = visibleSteps[idx - 1];
    if (prev) setStep(prev);
  };

  // Trigger extraction automatically when entering "extract" step
  useEffect(() => {
    if (step !== "extract") return;
    const url = normalizeUrl(websiteUrl);
    if (!url) { setExtractStatus("skipped"); return; }
    if (extractRanFor.current === url && extractStatus === "ok") return;
    extractRanFor.current = url;
    runExtraction(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const runExtraction = async (url: string) => {
    setExtractStatus("loading");
    setExtractError(null);
    setExtractProgress({ stage: "start", message: "Starting…", pct: 2 });
    try {
      const res = await authedFetch("/api/brand-extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let data: any = null;
      let streamError: string | null = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt: any;
          try { evt = JSON.parse(t); } catch { continue; }
          if (evt.type === "progress") {
            setExtractProgress({ stage: evt.stage, message: evt.message, pct: evt.pct ?? 0 });
          } else if (evt.type === "result") {
            data = evt.data;
          } else if (evt.type === "error") {
            streamError = evt.error || "Extraction failed";
          }
        }
      }
      if (streamError) throw new Error(streamError);
      if (!data) throw new Error("No data returned");
      setBrand((prev) => ({ ...prev, ...data, websiteUrl: url }));
      // Seed personalization fields from extraction if blank
      setDoRules((v) => v || data.doRules || "");
      setDontRules((v) => v || data.dontRules || "");
      if (Array.isArray(data.competitors) && data.competitors.length && !competitorsText) {
        setCompetitorsText(data.competitors.slice(0, 5).map((c: any) => c.name).filter(Boolean).join(", "));
      }
      setExtractStatus("ok");
      setExtractProgress({ stage: "done", message: "Done", pct: 100 });
    } catch (e: any) {
      setExtractStatus("error");
      setExtractError(e?.message ?? "Extraction failed");
    }
  };

  const finishAndSave = async () => {
    if (!workspaceId) return;
    setSaving(true);
    const finalUrl = websiteUrl.trim() ? normalizeUrl(websiteUrl) : null;

    // 1. Update workspace row
    const { error } = await supabase.from("workspaces").update({
      first_prompt: firstPrompt.trim() || null,
      website_url: finalUrl,
      connected_provider: provider || null,
      industry: brand.industry?.trim() || null,
      audience: brand.audience?.trim() || null,
      goals: goals.trim() || null,
      onboarded_at: new Date().toISOString(),
    }).eq("id", workspaceId);

    if (error) { setSaving(false); toast.error("Couldn't save your setup"); setStep("personalize"); return; }

    // 2. Persist Brand DNA into localStorage so Memory panel is pre-filled
    try {
      const personalNotes: BrandDna["userInsights"] = [];
      const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
      if (goals.trim()) personalNotes.push({ id: uid(), title: "Top goals (90 days)", body: goals.trim(), createdAt: Date.now(), source: "user" });
      if (primaryKpis.length) personalNotes.push({ id: uid(), title: "Primary KPIs", body: primaryKpis.join(", "), createdAt: Date.now(), source: "user" });
      if (cadence) personalNotes.push({ id: uid(), title: "Content cadence", body: cadence, createdAt: Date.now(), source: "user" });
      if (platforms.length) personalNotes.push({ id: uid(), title: "Focus platforms", body: platforms.join(", "), createdAt: Date.now(), source: "user" });
      if (voiceTone.length) personalNotes.push({ id: uid(), title: "Voice tone", body: voiceTone.join(", "), createdAt: Date.now(), source: "user" });

      const extraCompetitors = competitorsText
        .split(/[,\n]/).map((s) => s.trim()).filter(Boolean)
        .map((name) => ({ id: uid(), name }));

      const merged: BrandDna = {
        ...emptyDna,
        ...brand,
        websiteUrl: finalUrl,
        brandName: brand.brandName || "",
        doRules: doRules.trim() || brand.doRules || "",
        dontRules: dontRules.trim() || brand.dontRules || "",
        voice: voiceTone.length ? voiceTone.join(", ") : (brand.voice || ""),
        competitors: [
          ...(brand.competitors ?? []),
          ...extraCompetitors.filter((c) => !(brand.competitors ?? []).some((b) => b.name.toLowerCase() === c.name.toLowerCase())),
        ],
        userInsights: personalNotes,
        status: extractStatus === "ok" ? "ok" : "idle",
        extractedAt: extractStatus === "ok" ? Date.now() : null,
        updatedAt: Date.now(),
      };
      localStorage.setItem(`brand-dna:v3:${workspaceId}`, JSON.stringify(merged));
      try { saveDesignMd(workspaceId, buildDesignMd(merged)); } catch {}
    } catch (e) {
      console.warn("brand dna persist failed", e);
    }

    // 3. First prompt is persisted on the workspace row (`first_prompt`) above.
    //    ChatPanel picks it up on mount and runs it through the real send()
    //    pipeline (clarify → stream → assistant reply). We intentionally do NOT
    //    insert a raw chat_messages row here — that produced a lonely user
    //    message with no assistant response.

    setSaving(false);
    setStep("done");
  };

  // Analyze step triggers save
  useEffect(() => {
    if (step !== "analyze" || !workspaceId) return;
    const t = setTimeout(() => { finishAndSave(); }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, workspaceId]);

  const totalSteps = visibleSteps.filter((s) => s !== "analyze" && s !== "done").length;
  const stepNumber = Math.min(idx + 1, totalSteps);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sm:px-6">
        <div className="flex items-center">
          <Logo height={32} />
        </div>
        {step !== "done" && step !== "analyze" && step !== "extract" && (
          <button
            onClick={() => setStep("analyze")}
            className="text-[12px] text-muted-foreground hover:text-foreground"
          >
            Skip setup
          </button>
        )}
      </header>

      <div className="h-0.5 w-full bg-border">
        <motion.div
          className="h-full bg-primary"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      <section className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-2xl">
          <StarGuide step={step} firstPrompt={firstPrompt} websiteUrl={websiteUrl} provider={provider} />
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              {step === "prompt" && (
                <StepShell
                  icon={<Sparkles className="h-4 w-4" />}
                  eyebrow={`Step ${stepNumber} of ${totalSteps}`}
                  title="What's your first marketing move?"
                  subtitle="Tell Ravi 1.0 the outcome you want — it'll route the work to the right agents."
                >
                  <div className="focus-glow rounded-xl border border-border bg-card">
                    <textarea
                      autoFocus
                      value={firstPrompt}
                      onChange={(e) => setFirstPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) goNext(); }}
                      placeholder="e.g. Audit our AEO visibility and ship a 3-post launch plan for next week"
                      rows={4}
                      className="w-full resize-none rounded-xl bg-transparent px-4 py-3.5 text-[14px] outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {PROMPT_SUGGESTIONS.map((s) => {
                      const Icon = s.icon;
                      return (
                        <button
                          key={s.label}
                          onClick={() => setFirstPrompt(s.label)}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-[#0d0d0d] px-4 py-2 text-[13px] font-medium text-zinc-100 transition hover:bg-[#171717] hover:border-white/15 hover:-translate-y-px"
                        >
                          <Icon className="h-3.5 w-3.5 text-zinc-400" />
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </StepShell>
              )}

              {step === "website" && (
                <StepShell
                  icon={<Globe className="h-4 w-4" />}
                  eyebrow={`Step ${stepNumber} of ${totalSteps}`}
                  title="Where does your brand live?"
                  subtitle="Drop your URL — Ravi will read your site, sitemap, socials and external mentions to auto-fill your Memory."
                >
                  <div className="focus-glow flex items-center gap-2 rounded-xl border border-border bg-card px-3.5 py-3">
                    <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <input
                      autoFocus
                      value={websiteUrl}
                      onChange={(e) => setWebsiteUrl(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && canNext) goNext(); }}
                      placeholder="https://yourcompany.com"
                      className="flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
                    />
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">Optional — skip to fill it in by hand.</p>
                </StepShell>
              )}

              {step === "extract" && (
                <ExtractView
                  url={normalizeUrl(websiteUrl)}
                  status={extractStatus}
                  progress={extractProgress}
                  error={extractError}
                  onRetry={() => runExtraction(normalizeUrl(websiteUrl))}
                  onSkip={() => { setExtractStatus("skipped"); goNext(); }}
                />
              )}

              {step === "review" && (
                <ReviewView
                  brand={brand}
                  onChange={(patch) => setBrand((prev) => ({ ...prev, ...patch }))}
                  onRetry={() => runExtraction(normalizeUrl(websiteUrl))}
                  loading={extractStatus === "loading"}
                />
              )}

              {step === "personalize" && (
                <PersonalizeView
                  goals={goals} setGoals={setGoals}
                  primaryKpis={primaryKpis} setPrimaryKpis={setPrimaryKpis}
                  cadence={cadence} setCadence={setCadence}
                  platforms={platforms} setPlatforms={setPlatforms}
                  competitorsText={competitorsText} setCompetitorsText={setCompetitorsText}
                  voiceTone={voiceTone} setVoiceTone={setVoiceTone}
                  doRules={doRules} setDoRules={setDoRules}
                  dontRules={dontRules} setDontRules={setDontRules}
                  extractedCompetitors={(brand.competitors ?? []).map((c) => c.name).filter(Boolean)}
                  extractedAudience={brand.audience || ""}
                />
              )}

              {step === "connect" && (
                <StepShell
                  icon={<Github className="h-4 w-4" />}
                  eyebrow={`Step ${stepNumber} of ${totalSteps}`}
                  title="Where should agents publish?"
                  subtitle="Pick a destination Raval AI can post to. You can connect more from Settings anytime."
                >
                  <div className="grid gap-2">
                    {[
                      { id: "github",    label: "GitHub",    desc: "Read repos, ship pull requests (coming soon)",  Icon: Github },
                      { id: "wordpress", label: "WordPress", desc: "Publish posts and pages directly (coming soon)", Icon: Globe  },
                      { id: "none",      label: "Skip for now", desc: "Stay in chat — connect a destination later",   Icon: SkipForward },
                    ].map((opt) => {
                      const active = provider === (opt.id as any);
                      return (
                        <button
                          key={opt.id}
                          onClick={() => setProvider(opt.id as any)}
                          className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                            active
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-primary/40 hover:bg-secondary/40"
                          }`}
                        >
                          <div className={`grid h-9 w-9 place-items-center rounded-lg ${active ? "bg-primary/10 text-primary" : "bg-secondary text-foreground"}`}>
                            <opt.Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-[13.5px] font-medium">{opt.label}</div>
                            <div className="text-[12px] text-muted-foreground">{opt.desc}</div>
                          </div>
                          {active && <Check className="h-4 w-4 text-primary" />}
                        </button>
                      );
                    })}
                  </div>
                </StepShell>
              )}

              {step === "analyze" && (
                <AnalyzeView website={websiteUrl} provider={provider} saving={saving} />
              )}

              {step === "done" && (
                <DoneView onEnter={() => navigate({ to: "/app" })} />
              )}
            </motion.div>
          </AnimatePresence>

          {step !== "analyze" && step !== "done" && (
            <div className="mt-8 flex items-center justify-between">
              <button
                onClick={goBack}
                disabled={idx === 0}
                className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground transition hover:text-foreground disabled:opacity-40"
              >
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <button
                onClick={goNext}
                disabled={!canNext}
                className="btn-primary-glow inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {step === "connect" ? "Analyze" : "Continue"}
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Sub-components ---------------- */

function StepShell({
  icon, eyebrow, title, subtitle, children,
}: { icon: React.ReactNode; eyebrow: string; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-primary">{icon}</span>
        <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</span>
      </div>
      <h1 className="text-[24px] font-semibold leading-tight tracking-tight">{title}</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">{subtitle}</p>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <div className="focus-glow rounded-xl border border-border bg-card px-3.5 py-2.5">{children}</div>
      {hint && <span className="mt-1 block text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ExtractView({
  url, status, progress, error, onRetry, onSkip,
}: {
  url: string;
  status: "idle" | "loading" | "ok" | "error" | "skipped";
  progress: { stage: string; message: string; pct: number };
  error: string | null;
  onRetry: () => void;
  onSkip: () => void;
}) {
  const isLoading = status === "loading";
  const isError = status === "error";
  const isOk = status === "ok";
  return (
    <div className="text-center">
      <div className="mx-auto flex justify-center">
        <StarAgent mood={isError ? "thinking" : isOk ? "excited" : "scanning"} size={96} animate />
      </div>
      <h2 className="mt-5 text-[22px] font-semibold tracking-tight">
        {isOk ? "Memory drafted" : isError ? "Couldn't read the site" : "Reading your site"}
      </h2>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
        {isError ? (error || "Try again — or skip and fill manually.") :
         isOk ? "Review what we found on the next step — edit anything that's off." :
         `Crawling ${url.replace(/^https?:\/\//, "")} · sitemap · socials · external mentions`}
      </p>

      <div className="mx-auto mt-6 max-w-md">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full bg-primary"
            initial={false}
            animate={{ width: `${Math.max(progress.pct, isOk ? 100 : 0)}%` }}
            transition={{ duration: 0.4 }}
          />
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground truncate">
          {isLoading ? progress.message : isOk ? "Done." : isError ? error : "Waiting…"}
        </p>
      </div>

      {(isError || isOk) && (
        <div className="mt-6 flex justify-center gap-2">
          {isError && (
            <>
              <button
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[12.5px] hover:bg-secondary"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
              <button
                onClick={onSkip}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] text-muted-foreground hover:text-foreground"
              >
                Skip & fill manually
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewView({
  brand, onChange, onRetry, loading,
}: {
  brand: Partial<BrandDna>;
  onChange: (patch: Partial<BrandDna>) => void;
  onRetry: () => void;
  loading: boolean;
}) {
  const filled = [
    brand.brandName, brand.oneLiner, brand.industry, brand.audience, brand.voice, brand.products,
  ].filter((v) => (v as string | undefined)?.trim()).length;
  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-primary">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Review extracted info
            </span>
          </div>
          <h1 className="text-[24px] font-semibold leading-tight tracking-tight">Here's what we found</h1>
          <p className="mt-1.5 text-[13.5px] text-muted-foreground">
            {filled} of 6 fields auto-filled · edit anything that's off, then continue.
          </p>
        </div>
        <button
          onClick={onRetry}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Re-scan
        </button>
      </div>

      <div className="space-y-2.5">
        <Field label="Brand name">
          <input value={brand.brandName ?? ""} onChange={(e) => onChange({ brandName: e.target.value })} placeholder="Your company name" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>
        <Field label="One-liner" hint="Sharp positioning, one sentence.">
          <input value={brand.oneLiner ?? ""} onChange={(e) => onChange({ oneLiner: e.target.value })} placeholder="What you do, for whom, why it matters" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Industry">
            <input value={brand.industry ?? ""} onChange={(e) => onChange({ industry: e.target.value })} placeholder="e.g. B2B SaaS" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
          </Field>
          <Field label="Business model">
            <input value={brand.businessModel ?? ""} onChange={(e) => onChange({ businessModel: e.target.value })} placeholder="e.g. Subscription · Marketplace" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
          </Field>
        </div>
        <Field label="Target audience">
          <input value={brand.audience ?? ""} onChange={(e) => onChange({ audience: e.target.value })} placeholder="Who you serve" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>
        <Field label="Brand voice" hint="Tone descriptors, e.g. 'Confident, technical, dry humor'.">
          <input value={brand.voice ?? ""} onChange={(e) => onChange({ voice: e.target.value })} placeholder="How you sound" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>
        <Field label="Products / services">
          <input value={brand.products ?? ""} onChange={(e) => onChange({ products: e.target.value })} placeholder="What you sell" className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>
        <Field label="About" hint="A short paragraph — Ravi uses this in every brief.">
          <textarea rows={3} value={brand.about ?? ""} onChange={(e) => onChange({ about: e.target.value })} placeholder="What the company does, in 2–3 sentences" className="w-full resize-none bg-transparent text-[14px] outline-none placeholder:text-muted-foreground" />
        </Field>

        {(brand.colors?.length || brand.fonts?.length || brand.logoUrl) && (
          <div className="mt-4 rounded-xl border border-border bg-card/60 p-3.5">
            <div className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Brand visuals detected</div>
            <div className="flex flex-wrap items-center gap-3">
              {brand.logoUrl && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                  <img src={brand.logoUrl} alt="" className="h-6 w-6 rounded object-contain" />
                  <span className="text-[12px] text-muted-foreground">Logo</span>
                </div>
              )}
              {(brand.colors ?? []).slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-border bg-background px-2 py-1.5">
                  <span className="h-4 w-4 rounded" style={{ background: c.hex }} />
                  <span className="text-[12px] font-mono text-muted-foreground">{c.hex}</span>
                </div>
              ))}
              {(brand.fonts ?? []).slice(0, 2).map((f, i) => (
                <div key={i} className="rounded-lg border border-border bg-background px-2 py-1.5 text-[12px] text-muted-foreground">
                  Aa · {f}
                </div>
              ))}
            </div>
          </div>
        )}

        {(brand.competitors?.length || brand.socials?.length) && (
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {!!brand.competitors?.length && (
              <div className="rounded-xl border border-border bg-card/60 p-3.5">
                <div className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Competitors found</div>
                <ul className="space-y-1 text-[12.5px]">
                  {brand.competitors.slice(0, 5).map((c, i) => (
                    <li key={i} className="truncate">• {c.name}{c.positioning ? <span className="text-muted-foreground"> — {c.positioning}</span> : null}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!brand.socials?.length && (
              <div className="rounded-xl border border-border bg-card/60 p-3.5">
                <div className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Socials found</div>
                <ul className="space-y-1 text-[12.5px]">
                  {brand.socials.slice(0, 6).map((s, i) => (
                    <li key={i} className="truncate capitalize">• {s.platform}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChipGroup({
  options, value, onChange, multi = true,
}: { options: string[]; value: string[]; onChange: (v: string[]) => void; multi?: boolean }) {
  const toggle = (o: string) => {
    if (value.includes(o)) onChange(value.filter((v) => v !== o));
    else onChange(multi ? [...value, o] : [o]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const active = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            onClick={() => toggle(o)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] transition ${
              active ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
            }`}
          >
            {active && <Check className="h-3 w-3" />}
            {!active && <Plus className="h-3 w-3" />}
            {o}
          </button>
        );
      })}
    </div>
  );
}

function PersonalizeView({
  goals, setGoals,
  primaryKpis, setPrimaryKpis,
  cadence, setCadence,
  platforms, setPlatforms,
  competitorsText, setCompetitorsText,
  voiceTone, setVoiceTone,
  doRules, setDoRules,
  dontRules, setDontRules,
  extractedCompetitors, extractedAudience,
}: {
  goals: string; setGoals: (v: string) => void;
  primaryKpis: string[]; setPrimaryKpis: (v: string[]) => void;
  cadence: string; setCadence: (v: string) => void;
  platforms: string[]; setPlatforms: (v: string[]) => void;
  competitorsText: string; setCompetitorsText: (v: string) => void;
  voiceTone: string[]; setVoiceTone: (v: string[]) => void;
  doRules: string; setDoRules: (v: string) => void;
  dontRules: string; setDontRules: (v: string) => void;
  extractedCompetitors: string[];
  extractedAudience: string;
}) {
  const VOICE_TONES = ["Confident", "Friendly", "Technical", "Playful", "Authoritative", "Warm", "Witty", "Minimal"];
  return (
    <div>
      <div className="mb-5 flex items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-border bg-card text-primary">
          <Wand2 className="h-4 w-4" />
        </span>
        <span className="text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Personalize</span>
      </div>
      <h1 className="text-[24px] font-semibold leading-tight tracking-tight">A few more details</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
        These shape every brief Ravi writes. {extractedAudience ? `We already noted your audience is "${extractedAudience}".` : "All optional."}
      </p>

      <div className="mt-6 space-y-3">
        <Field label="Top goals (next 90 days)" hint="What does success look like?">
          <input
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            placeholder="e.g. 2x organic traffic, launch v2, lower CAC"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
        </Field>

        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <Target className="h-3.5 w-3.5" /> Primary KPIs
          </span>
          <ChipGroup options={KPI_OPTIONS} value={primaryKpis} onChange={setPrimaryKpis} />
        </div>

        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <Megaphone className="h-3.5 w-3.5" /> Focus platforms
          </span>
          <ChipGroup options={PLATFORM_OPTIONS} value={platforms} onChange={setPlatforms} />
        </div>

        <div>
          <span className="mb-2 block text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Content cadence</span>
          <ChipGroup options={CADENCE_OPTIONS} value={cadence ? [cadence] : []} onChange={(v) => setCadence(v[0] || "")} multi={false} />
        </div>

        <div>
          <span className="mb-2 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> Voice tone
          </span>
          <ChipGroup options={VOICE_TONES} value={voiceTone} onChange={setVoiceTone} />
        </div>

        <Field
          label="Competitors"
          hint={extractedCompetitors.length ? `Found: ${extractedCompetitors.slice(0, 4).join(", ")} — add more, comma separated.` : "Comma separated — names or URLs."}
        >
          <input
            value={competitorsText}
            onChange={(e) => setCompetitorsText(e.target.value)}
            placeholder="e.g. Notion, Linear, Figma"
            className="w-full bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
          />
        </Field>

        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="Brand do's" hint="2–3 rules every agent should follow.">
            <textarea rows={2} value={doRules} onChange={(e) => setDoRules(e.target.value)} placeholder="e.g. Use specific numbers; mention real customers" className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
          </Field>
          <Field label="Brand don'ts" hint="Words/topics to avoid.">
            <textarea rows={2} value={dontRules} onChange={(e) => setDontRules(e.target.value)} placeholder="e.g. No emojis; never say 'revolutionary'" className="w-full resize-none bg-transparent text-[13px] outline-none placeholder:text-muted-foreground" />
          </Field>
        </div>
      </div>
    </div>
  );
}

function AnalyzeView({ website, provider, saving }: { website: string; provider: string; saving: boolean }) {
  const tasks = [
    website ? `Scanning ${website.replace(/^https?:\/\//, "")}` : "Preparing your workspace",
    provider && provider !== "none" ? `Linking ${provider}` : "Calibrating brand voice",
    "Briefing your agents",
    "Tuning the dashboard",
  ];
  const [done, setDone] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setDone((d) => Math.min(d + 1, tasks.length)), 420);
    return () => clearInterval(id);
  }, [tasks.length]);
  return (
    <div className="text-center">
      <div className="mx-auto flex justify-center">
        <StarAgent mood="scanning" size={96} animate />
      </div>
      <h2 className="mt-5 text-[22px] font-semibold tracking-tight">Finalizing your workspace</h2>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
        {saving ? "Saving your setup…" : "Star is wiring everything together — one moment."}
      </p>
      <ul className="mx-auto mt-7 max-w-sm space-y-1.5 text-left">
        {tasks.map((t, i) => (
          <motion.li
            key={t}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.14 }}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px]"
          >
            {i < done
              ? <Check className="h-3.5 w-3.5 text-success" />
              : <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <span className={i < done ? "text-foreground" : "text-muted-foreground"}>{t}</span>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function DoneView({ onEnter }: { onEnter: () => void }) {
  useEffect(() => { const t = setTimeout(onEnter, 1600); return () => clearTimeout(t); }, [onEnter]);
  return (
    <div className="text-center">
      <div className="mx-auto flex justify-center">
        <StarAgent mood="superhero" size={110} animate message="Let's ship something great." />
      </div>
      <h2 className="mt-5 text-[22px] font-semibold tracking-tight">You're all set</h2>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">Bringing you to your Command Center…</p>
      <button
        onClick={onEnter}
        className="btn-primary-glow mt-6 inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground transition hover:bg-primary/90"
      >
        Enter dashboard <ArrowUp className="h-3.5 w-3.5 rotate-45" />
      </button>
    </div>
  );
}

function StarGuide({
  step, firstPrompt, websiteUrl, provider,
}: { step: Step; firstPrompt: string; websiteUrl: string; provider: string }) {
  if (step === "analyze" || step === "done" || step === "extract") return null;

  const guide: Partial<Record<Step, { mood: StarMood; tip: string }>> = {
    prompt: {
      mood: firstPrompt.trim().length >= 4 ? "excited" : "happy",
      tip: "Hi, I'm Star ✦ Tell me one outcome you want — I'll route it to the right agent.",
    },
    website: {
      mood: /^https?:\/\/.+\..+/.test(websiteUrl.trim()) ? "scanning" : "thinking",
      tip: "Drop your site and I'll auto-fill your Memory from it. Optional — but worth it.",
    },
    review: {
      mood: "excited",
      tip: "I drafted your Brand DNA from your site. Tweak anything that's off — it powers every agent.",
    },
    personalize: {
      mood: "thinking",
      tip: "A bit more about your goals, tone and competitors — so every reply sounds like you.",
    },
    connect: {
      mood: provider ? "excited" : "waving",
      tip: "Pick a place to publish (or skip — you can link it later).",
    },
  };

  const g = guide[step];
  if (!g) return null;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={step + g.mood}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.3 }}
        className="mb-6 flex items-start gap-3"
      >
        <StarAgent mood={g.mood} size={64} animate />
        <div className="relative mt-2 flex-1">
          <div className="absolute -left-2 top-3 h-3 w-3 rotate-45 border-l border-t border-border bg-card" />
          <div className="rounded-xl border border-border bg-card px-3.5 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
            {g.tip}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

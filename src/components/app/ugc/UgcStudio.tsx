"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Globe, Lightbulb, Plus, Trash2, Video } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { emitAppEvent } from "@/lib/app-events";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import { platformPreset } from "@/lib/ugc/options";
import {
  ACTIVE_RENDER_STATUSES,
  BriefSchema,
  type AllowanceView,
  type Brief,
  type ModelView,
  type Product,
  type ProjectSummary,
  type ProjectView,
  type ReferenceImageView,
  type RenderView,
  type Script,
} from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { BriefStep } from "./BriefStep";
import { applyHook, ConceptsStep, ConceptsWriting } from "./ConceptsStep";
import { coerceSettings, GenerateStep, type RenderSettingsState } from "./GenerateStep";
import { ProductStep } from "./ProductStep";
import { RenderPanel } from "./RenderPanel";
import { ScriptStep } from "./ScriptStep";
import {
  CreatorSilhouette,
  itemVariants,
  listVariants,
  Panel,
  PhoneFrame,
  RenderStatusChip,
  StepFrame,
  Stepper,
  type StepId,
} from "./ugc-ui";

type View = { kind: "home" } | { kind: "new" } | { kind: "project"; id: string };

function errorMessage(error: unknown, fallback: string) {
  return error instanceof UgcApiError ? error.message : fallback;
}

export function UgcStudio({
  workspaceId,
  initialProjectId,
}: {
  workspaceId: string;
  initialProjectId?: string | null;
}) {
  const [view, setView] = useState<View>(
    initialProjectId ? { kind: "project", id: initialProjectId } : { kind: "home" },
  );
  const [catalog, setCatalog] = useState<{
    models: ModelView[];
    defaultModel: string;
    allowance: AllowanceView;
  } | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const loadCatalog = useCallback(() => {
    ugcApi
      .models(workspaceId)
      .then((c) => {
        setCatalog(c);
        setCatalogError(null);
      })
      .catch((e) => setCatalogError(errorMessage(e, "Couldn't load video models.")));
  }, [workspaceId]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (initialProjectId) setView({ kind: "project", id: initialProjectId });
  }, [initialProjectId]);

  if (catalogError) {
    return (
      <ErrorState
        title="Video ads aren't available right now"
        description={catalogError}
        onRetry={loadCatalog}
      />
    );
  }

  if (view.kind === "home") {
    return (
      <UgcHome
        workspaceId={workspaceId}
        allowance={catalog?.allowance ?? null}
        onNew={() => setView({ kind: "new" })}
        onOpen={(id) => setView({ kind: "project", id })}
      />
    );
  }

  return (
    <ProjectEditor
      key={view.kind === "project" ? view.id : "new"}
      workspaceId={workspaceId}
      projectId={view.kind === "project" ? view.id : null}
      catalog={catalog}
      refreshAllowance={loadCatalog}
      onCreated={(id) => setView({ kind: "project", id })}
      onExit={() => setView({ kind: "home" })}
    />
  );
}

const HERO_HOOKS = ["Okay, I didn't expect this…", "3 reasons I switched", "Watch what happens"];

const FLOW = [
  { icon: Globe, label: "Link" },
  { icon: Lightbulb, label: "Idea" },
  { icon: Video, label: "Video" },
] as const;

/** Three phones fanned out, each cycling a creator hook: the product in one glance. */
function HeroPhones() {
  const reduce = useReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 2600);
    return () => window.clearInterval(id);
  }, [reduce]);
  const placements = [
    { rotate: -9, x: -58, y: 12, z: 0 },
    { rotate: 0, x: 0, y: 0, z: 2 },
    { rotate: 9, x: 58, y: 12, z: 1 },
  ];
  return (
    <div className="relative mx-auto h-[210px] w-[250px] shrink-0" aria-hidden>
      {placements.map((p, i) => (
        <motion.div
          key={i}
          className="absolute left-1/2 top-0 w-[104px]"
          style={{ zIndex: p.z, marginLeft: -52 }}
          initial={reduce ? false : { opacity: 0, y: 30, rotate: 0, x: 0 }}
          animate={
            reduce
              ? { rotate: p.rotate, x: p.x, y: p.y }
              : {
                  opacity: 1,
                  rotate: p.rotate,
                  x: p.x,
                  y: [p.y, p.y - 6, p.y],
                }
          }
          transition={
            reduce
              ? undefined
              : {
                  opacity: { duration: 0.5, delay: i * 0.12 },
                  rotate: { duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] },
                  x: { duration: 0.7, delay: i * 0.12, ease: [0.22, 1, 0.36, 1] },
                  y: { duration: 4, delay: i * 0.6, repeat: Infinity, ease: "easeInOut" },
                }
          }
        >
          <PhoneFrame className="rounded-[20px] p-[3px]" screenClassName="rounded-[17px]">
            <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,hsl(var(--primary)/0.35),transparent_60%)]" />
            <div className="absolute inset-x-3 bottom-0 top-8">
              <CreatorSilhouette />
            </div>
            <div className="absolute inset-x-1.5 bottom-3">
              <AnimatePresence mode="wait">
                <motion.p
                  key={(tick + i) % HERO_HOOKS.length}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.3 }}
                  className="rounded-md bg-black/70 px-1.5 py-1 text-center text-[8.5px] font-semibold leading-tight"
                >
                  {HERO_HOOKS[(tick + i) % HERO_HOOKS.length]}
                </motion.p>
              </AnimatePresence>
            </div>
          </PhoneFrame>
        </motion.div>
      ))}
    </div>
  );
}

function UgcHome({
  workspaceId,
  allowance,
  onNew,
  onOpen,
}: {
  workspaceId: string;
  allowance: AllowanceView | null;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
  const reduce = useReducedMotion();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    ugcApi
      .listProjects(workspaceId)
      .then(setProjects)
      .catch((e) => setError(errorMessage(e, "Couldn't load your ads.")));
  }, [workspaceId]);
  useEffect(() => load(), [load]);

  const videosLeft = allowance
    ? Math.max(0, allowance.videos.limit - allowance.videos.used - allowance.videos.held)
    : null;

  return (
    <div className="space-y-7 pb-4">
      <Panel className="ds-glow relative overflow-hidden p-5 sm:p-7">
        <div className="relative flex flex-col items-center gap-6 md:flex-row md:justify-between">
          <div className="max-w-md space-y-5 text-center md:text-left">
            <h3 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-tight">
              Your product, <span className="text-primary">filmed by a creator</span>
            </h3>
            <ol className="flex items-center justify-center gap-2 md:justify-start">
              {FLOW.map((f, i) => (
                <motion.li
                  key={f.label}
                  initial={reduce ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.15 + i * 0.12, duration: 0.35 }}
                  className="flex items-center gap-2"
                >
                  <span className="flex items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-xs font-medium">
                    <f.icon className="size-3.5 text-primary" aria-hidden />
                    {f.label}
                  </span>
                  {i < FLOW.length - 1 ? (
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                  ) : null}
                </motion.li>
              ))}
            </ol>
            <div className="flex flex-col items-center gap-2 sm:flex-row md:justify-start">
              <Button size="xl" onClick={onNew}>
                <Plus aria-hidden /> New video ad
              </Button>
              {videosLeft !== null ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {videosLeft} video{videosLeft === 1 ? "" : "s"} left this month
                </span>
              ) : null}
            </div>
          </div>
          <HeroPhones />
        </div>
      </Panel>

      <section className="space-y-3">
        <h4 className="ds-label text-[11px]">Your ads</h4>
        {error ? (
          <ErrorState size="sm" title="Couldn't load your ads" description={error} onRetry={load} />
        ) : projects === null ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="aspect-[9/16] rounded-[22px]" />
            ))}
          </div>
        ) : (
          <motion.ul
            initial={reduce ? false : "hidden"}
            animate="show"
            variants={listVariants}
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
          >
            <motion.li variants={reduce ? undefined : itemVariants}>
              <button
                type="button"
                onClick={onNew}
                className="group flex aspect-[9/16] w-full flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed border-[var(--ds-tile-border)] text-muted-foreground transition-colors hover:border-primary/60 hover:bg-primary/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
              >
                <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary transition-transform group-hover:scale-110">
                  <Plus className="size-5" aria-hidden />
                </span>
                <span className="text-sm font-medium">New</span>
              </button>
            </motion.li>
            {projects.map((p) => (
              <motion.li key={p.id} variants={reduce ? undefined : itemVariants}>
                <AdCard
                  project={p}
                  onOpen={() => onOpen(p.id)}
                  onArchive={async () => {
                    try {
                      await ugcApi.archiveProject(workspaceId, p.id);
                      setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
                    } catch (e) {
                      toast.error(errorMessage(e, "Couldn't archive that ad."));
                    }
                  }}
                />
              </motion.li>
            ))}
          </motion.ul>
        )}
      </section>
    </div>
  );
}

/** A vertical ad card: the video plays on hover, like a feed. */
function AdCard({
  project: p,
  onOpen,
  onArchive,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onArchive: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div
      className="group relative"
      onMouseEnter={() => void videoRef.current?.play().catch(() => undefined)}
      onMouseLeave={() => {
        const v = videoRef.current;
        if (v) {
          v.pause();
          v.currentTime = 0;
        }
      }}
    >
      <div className="relative aspect-[9/16] overflow-hidden rounded-[22px] bg-neutral-900 ring-1 ring-[var(--ds-tile-border)] transition-[transform,box-shadow] duration-300 group-hover:-translate-y-1 group-hover:shadow-[0_18px_40px_-20px_hsl(var(--primary)/0.7)]">
        {p.latestRender?.videoUrl ? (
          <video
            ref={videoRef}
            src={p.latestRender.videoUrl}
            muted
            loop
            playsInline
            preload="metadata"
            className="size-full! object-cover"
          />
        ) : p.thumbnailUrl ? (
          <img
            src={p.thumbnailUrl}
            alt=""
            className="size-full! object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="absolute inset-x-4 bottom-0 top-10">
            <CreatorSilhouette />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
        <div className="absolute left-2.5 top-2.5">
          {p.latestRender ? (
            <RenderStatusChip status={p.latestRender.status} />
          ) : (
            <span className="inline-flex h-5 items-center rounded-full bg-black/55 px-2 text-[10.5px] font-medium text-white backdrop-blur">
              Draft
            </span>
          )}
        </div>
        <div className="absolute inset-x-3 bottom-3 text-white">
          <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{p.title}</p>
          <p className="mt-0.5 text-[11px] text-white/65">
            {new Date(p.updatedAt).toLocaleDateString()}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 rounded-[22px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        aria-label={`Open ${p.title}`}
      />
      <button
        type="button"
        aria-label={`Archive ${p.title}`}
        onClick={onArchive}
        className="absolute right-2 top-2 z-10 grid size-8 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur transition hover:bg-black/80 focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
      >
        <Trash2 className="size-4" aria-hidden />
      </button>
    </div>
  );
}

function defaultStep(project: ProjectView): StepId {
  if (project.renders.length) return "generate";
  if (project.script) return "script";
  if (project.concepts.length) return "concepts";
  return "brief";
}

function ProjectEditor({
  workspaceId,
  projectId,
  catalog,
  refreshAllowance,
  onCreated,
  onExit,
}: {
  workspaceId: string;
  projectId: string | null;
  catalog: { models: ModelView[]; defaultModel: string; allowance: AllowanceView } | null;
  refreshAllowance: () => void;
  onCreated: (id: string) => void;
  onExit: () => void;
}) {
  const workspace = useWorkspace();
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState<StepId>("product");
  const [busy, setBusy] = useState<null | "saving" | "concepts" | "rewrite" | "render">(null);
  const [settings, setSettings] = useState<RenderSettingsState | null>(null);
  const [activeRender, setActiveRender] = useState<RenderView | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoadError(null);
    try {
      const p = await ugcApi.getProject(workspaceId, projectId);
      setProject(p);
      setStep(defaultStep(p));
      const live =
        p.renders.find((r) => ACTIVE_RENDER_STATUSES.includes(r.status)) ?? p.renders[0] ?? null;
      setActiveRender(live);
    } catch (e) {
      setLoadError(errorMessage(e, "Couldn't open this ad."));
    }
  }, [workspaceId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Initial render settings once the model catalog and project are known.
  useEffect(() => {
    if (!catalog || settings) return;
    const model = catalog.models.find((m) => m.key === catalog.defaultModel) ?? catalog.models[0];
    if (!model) return;
    const preset = platformPreset(project?.brief.platform ?? "tiktok");
    setSettings({
      ...coerceSettings(
        model,
        {
          model: model.key,
          durationSec: preset.durationSec,
          aspectRatio: preset.aspectRatio,
          resolution: model.defaultResolution,
          referenceIds: project?.references.map((r) => r.assetId) ?? [],
        },
        preset.aspectRatio,
      ),
      model: "auto",
    });
  }, [catalog, project, settings]);

  const model =
    catalog?.models.find((m) => m.key === settings?.model) ??
    catalog?.models.find((m) => m.key === "standard") ??
    catalog?.models[0];
  const durationSec = settings?.durationSec ?? 8;

  const guard = async <T,>(
    kind: NonNullable<typeof busy>,
    fallback: string,
    fn: () => Promise<T>,
  ) => {
    setBusy(kind);
    try {
      return await fn();
    } catch (e) {
      toast.error(errorMessage(e, fallback));
      return undefined;
    } finally {
      setBusy(null);
    }
  };

  const saveProduct = (product: Product, references: ReferenceImageView[]) =>
    guard("saving", "Couldn't save the product.", async () => {
      const referenceAssetIds = references.map((r) => r.assetId);
      if (!project) {
        const created = await ugcApi.createProject(workspaceId, {
          product,
          brief: BriefSchema.parse({ audience: product.audienceHints[0] ?? "" }),
          referenceAssetIds,
        });
        setProject(created);
        setSettings((s) => (s ? { ...s, referenceIds: referenceAssetIds } : s));
        setStep("brief");
        onCreated(created.id);
        return;
      }
      const updated = await ugcApi.updateProject(workspaceId, project.id, {
        product,
        referenceAssetIds,
      });
      setProject(updated);
      setSettings((s) => (s ? { ...s, referenceIds: referenceAssetIds } : s));
      setStep("brief");
    });

  const applyBriefToSettings = (brief: Brief) => {
    if (!model || !settings) return;
    const preset = platformPreset(brief.platform);
    setSettings(
      coerceSettings(model, { ...settings, durationSec: preset.durationSec }, preset.aspectRatio),
    );
  };

  const generateConcepts = (brief: Brief) =>
    guard("concepts", "Couldn't write ideas.", async () => {
      if (!project) return;
      applyBriefToSettings(brief);
      setStep("concepts");
      try {
        await ugcApi.updateProject(workspaceId, project.id, { brief });
        const { project: next } = await ugcApi.generateConcepts(
          workspaceId,
          project.id,
          durationSec,
        );
        setProject(next);
        // Defensive: the server always returns at least one concept on success.
        if (!next.concepts.length) setStep("brief");
      } catch (error) {
        setStep("brief");
        throw error;
      }
    });

  const keepConcepts = (brief: Brief) =>
    guard("saving", "Couldn't save the details.", async () => {
      if (!project) return;
      applyBriefToSettings(brief);
      setProject(await ugcApi.updateProject(workspaceId, project.id, { brief }));
      setStep("concepts");
    });

  const chooseConcept = (conceptId: string, script: Script) =>
    guard("saving", "Couldn't select that idea.", async () => {
      if (!project) return;
      setProject(
        await ugcApi.updateProject(workspaceId, project.id, {
          selectedConceptId: conceptId,
          script,
        }),
      );
      setStep("script");
    });

  const saveScript = (script: Script, next: StepId) =>
    guard("saving", "Couldn't save the script.", async () => {
      if (!project) return;
      setProject(await ugcApi.updateProject(workspaceId, project.id, { script }));
      setStep(next);
    });

  const rewrite = (script: Script, instruction: string) =>
    guard("rewrite", "Couldn't rewrite the script.", async () => {
      if (!project) return;
      await ugcApi.updateProject(workspaceId, project.id, { script });
      const { project: next, warnings } = await ugcApi.rewriteScript(
        workspaceId,
        project.id,
        instruction,
        durationSec,
      );
      setProject(next);
      toast.success(warnings.length ? "Rewritten — check the flagged lines" : "Script rewritten");
    });

  const startRender = () =>
    guard("render", "Couldn't start the video.", async () => {
      if (!project || !settings) return;
      const { render } = await ugcApi.startRender(workspaceId, {
        projectId: project.id,
        idempotencyKey: crypto.randomUUID(),
        model: settings.model,
        durationSec: settings.durationSec,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        referenceAssetIds: settings.referenceIds,
      });
      setActiveRender(render);
      setProject((p) =>
        p ? { ...p, renders: [render, ...p.renders.filter((r) => r.id !== render.id)] } : p,
      );
      refreshAllowance();
    });

  const onSettled = useCallback(
    (render: RenderView) => {
      setProject((p) =>
        p ? { ...p, renders: p.renders.map((r) => (r.id === render.id ? render : r)) } : p,
      );
      refreshAllowance();
      if (render.status === "succeeded") {
        emitAppEvent("assets:changed");
        toast.success("Your video ad is ready");
      }
    },
    [refreshAllowance],
  );

  const reachable = useMemo(
    () => (id: StepId) => {
      if (!project) return id === "product";
      if (id === "product" || id === "brief") return true;
      if (id === "concepts") return project.concepts.length > 0;
      return Boolean(project.script);
    },
    [project],
  );

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't open this ad"
        description={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (projectId && !project) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-14 w-full rounded-full" />
        <Skeleton className="h-80 rounded-[20px]" />
      </div>
    );
  }

  const showRender = step === "generate" && activeRender;
  const cover = project?.references[0]?.url ?? project?.product.images[0]?.url ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon-sm" aria-label="All video ads" onClick={onExit}>
          <ArrowLeft aria-hidden />
        </Button>
        <span
          className={cn(
            "grid size-9 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--ds-well-bg)]",
          )}
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              className="size-full! object-cover"
              referrerPolicy="no-referrer"
            />
          ) : (
            <Video className="size-4 text-muted-foreground" aria-hidden />
          )}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
          {project?.title ?? "New video ad"}
        </h3>
      </div>
      <Stepper current={step} reachable={reachable} onSelect={setStep} />

      <AnimatePresence mode="wait">
        {step === "product" ? (
          <StepFrame key="product" stepKey="product">
            <ProductStep
              workspaceId={workspaceId}
              workspaceWebsite={workspace.websiteUrl}
              workspaceName={workspace.name}
              initialProduct={project?.product ?? null}
              initialReferences={project?.references ?? []}
              saving={busy === "saving"}
              onContinue={saveProduct}
            />
          </StepFrame>
        ) : step === "brief" && project ? (
          <StepFrame key="brief" stepKey="brief">
            <BriefStep
              workspaceId={workspaceId}
              projectId={project.id}
              initialBrief={project.brief}
              product={project.product}
              hasConcepts={project.concepts.length > 0}
              busy={busy === "concepts" || busy === "saving"}
              onBack={() => setStep("product")}
              onGenerate={(brief) => void generateConcepts(brief)}
              onSkipToConcepts={(brief) => void keepConcepts(brief)}
            />
          </StepFrame>
        ) : step === "concepts" && project ? (
          <StepFrame key="concepts" stepKey="concepts">
            {busy === "concepts" || !project.concepts.length ? (
              <ConceptsWriting />
            ) : (
              <ConceptsStep
                concepts={project.concepts}
                selectedConceptId={project.selectedConceptId}
                productImage={cover}
                busy={false}
                onBack={() => setStep("brief")}
                onRegenerate={() => void generateConcepts(project.brief)}
                onChoose={(concept, hook) => {
                  const current =
                    concept.id === project.selectedConceptId && project.script
                      ? project.script
                      : concept.script;
                  void chooseConcept(concept.id, applyHook(current, hook));
                }}
              />
            )}
          </StepFrame>
        ) : step === "script" && project?.script ? (
          <StepFrame key="script" stepKey="script">
            <ScriptStep
              key={project.updatedAt}
              initialScript={project.script}
              product={project.product}
              brief={project.brief}
              durationSec={durationSec}
              aspectRatio={
                settings?.aspectRatio ?? platformPreset(project.brief.platform).aspectRatio
              }
              productImage={cover}
              rewriting={busy === "rewrite"}
              saving={busy === "saving"}
              onBack={(script) => void saveScript(script, "concepts")}
              onRewrite={(script, instruction) => void rewrite(script, instruction)}
              onContinue={(script) => void saveScript(script, "generate")}
            />
          </StepFrame>
        ) : step === "generate" && project && settings ? (
          <StepFrame
            key={showRender ? `render-${activeRender.id}` : "generate"}
            stepKey={showRender ? `render-${activeRender.id}` : "generate"}
          >
            {showRender ? (
              <RenderPanel
                key={activeRender.id}
                workspaceId={workspaceId}
                render={activeRender}
                script={project.script}
                history={project.renders}
                onSettled={onSettled}
                regenerating={busy === "render"}
                onRegenerate={() => void startRender()}
                onEditSettings={() => setActiveRender(null)}
                onSelectRender={setActiveRender}
              />
            ) : (
              <GenerateStep
                models={catalog?.models ?? []}
                allowance={catalog?.allowance ?? null}
                loadingModels={!catalog}
                settings={settings}
                references={project.references}
                hook={project.script?.hook ?? ""}
                generating={busy === "render"}
                onChange={setSettings}
                onBack={() => setStep("script")}
                onGenerate={() => void startRender()}
              />
            )}
          </StepFrame>
        ) : (
          <StepFrame key="fallback" stepKey="fallback">
            <Panel className="text-sm text-muted-foreground">Finish the earlier steps first.</Panel>
          </StepFrame>
        )}
      </AnimatePresence>
    </div>
  );
}

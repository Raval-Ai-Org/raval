"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Video } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
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
import { BriefStep } from "./BriefStep";
import { applyHook, ConceptsStep, ConceptsWriting } from "./ConceptsStep";
import { coerceSettings, GenerateStep, type RenderSettingsState } from "./GenerateStep";
import { ProductStep } from "./ProductStep";
import { RenderPanel } from "./RenderPanel";
import { ScriptStep } from "./ScriptStep";
import { Panel, RenderStatusChip, StepFrame, Stepper, type StepId } from "./ugc-ui";

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
        title="Creator video ads aren't available right now"
        description={catalogError}
        onRetry={loadCatalog}
      />
    );
  }

  if (view.kind === "home") {
    return (
      <UgcHome
        workspaceId={workspaceId}
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

function UgcHome({
  workspaceId,
  onNew,
  onOpen,
}: {
  workspaceId: string;
  onNew: () => void;
  onOpen: (id: string) => void;
}) {
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

  return (
    <div className="space-y-5">
      <Panel className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-primary/15 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="max-w-lg">
            <h3 className="text-lg font-semibold tracking-tight">
              Turn a product page into a creator video ad
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Mellox reads your product, writes grounded concepts and a creator script, then films
              it with an AI creator — ready for TikTok, Reels, Shorts and Facebook.
            </p>
          </div>
          <Button size="lg" onClick={onNew} className="shrink-0">
            <Plus aria-hidden /> New video ad
          </Button>
        </div>
      </Panel>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Your ads</h4>
        {error ? (
          <ErrorState size="sm" title="Couldn't load your ads" description={error} onRetry={load} />
        ) : projects === null ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Video}
            title="No video ads yet"
            description="Start with a product link — your first concept takes about a minute."
            action={
              <Button onClick={onNew}>
                <Plus aria-hidden /> New video ad
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id}>
                <div className="group relative flex h-full items-center gap-3 rounded-2xl bg-surface-2/70 p-3 ring-1 ring-border/60 transition-colors hover:bg-surface-2">
                  <button
                    type="button"
                    onClick={() => onOpen(p.id)}
                    className="absolute inset-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                    aria-label={`Open ${p.title}`}
                  />
                  <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-3">
                    {p.latestRender?.videoUrl ? (
                      <video
                        src={p.latestRender.videoUrl}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-full object-cover"
                      />
                    ) : p.thumbnailUrl ? (
                      <img
                        src={p.thumbnailUrl}
                        alt=""
                        className="size-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <Video className="size-5 text-muted-foreground" aria-hidden />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(p.updatedAt).toLocaleDateString()}
                    </p>
                    <div className="mt-1">
                      {p.latestRender ? (
                        <RenderStatusChip status={p.latestRender.status} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground">Draft</span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Archive ${p.title}`}
                    onClick={async () => {
                      try {
                        await ugcApi.archiveProject(workspaceId, p.id);
                        setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null);
                      } catch (e) {
                        toast.error(errorMessage(e, "Couldn't archive that ad."));
                      }
                    }}
                    className="relative z-10 grid size-8 place-items-center rounded-lg text-muted-foreground opacity-0 transition hover:bg-surface-3 hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
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
    catalog?.models.find((m) => m.key === "seedance-2") ??
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
    guard("concepts", "Couldn't write concepts.", async () => {
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
    guard("saving", "Couldn't select that concept.", async () => {
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
      <div className="space-y-3">
        <Skeleton className="h-8 w-80 rounded-full" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  const showRender = step === "generate" && activeRender;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="All video ads" onClick={onExit}>
          <ArrowLeft aria-hidden />
        </Button>
        <h3 className="mr-auto min-w-0 truncate text-sm font-semibold">
          {project?.title ?? "New video ad"}
        </h3>
        <Stepper current={step} reachable={reachable} onSelect={setStep} />
      </div>

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
              onDurationHint={
                model ? `${model.displayName} renders ${settings?.durationSec}s.` : undefined
              }
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

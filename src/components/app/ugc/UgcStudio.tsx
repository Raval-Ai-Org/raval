"use client";

// Creator video ads (UGC). One Holo-style screen: pick a creator, a product
// from Brand DNA, write (or have Mox write) what they say, Generate. The
// product is never read from a page again: the Brand DNA scan already found
// it (ADR-0035). "Your videos" lists what was made.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "framer-motion";
import { toast } from "@/lib/toast";
import { Plus, Trash2 } from "@/components/icons";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { emitAppEvent } from "@/lib/app-events";
import { creditsFor } from "@/lib/billing/catalog";
import { parseLook } from "@/lib/brand-look/spec";
import { getVisualTaste } from "@/lib/brand-visuals.functions";
import { tidyLook } from "@/lib/inspo/look";
import { listProducts } from "@/lib/products.functions";
import { creatorBrief, toCreatorScript, type ScriptVideoSource } from "@/lib/studio/script-video";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import {
  STOCK_CREATORS,
  creatorsInOrder,
  stockCreator,
  suggestCreators,
  type BrandCreatorRef,
} from "@/lib/ugc/creators";
import { ugcProductFromCatalogue } from "@/lib/ugc/from-catalogue";
import { LANGUAGES, platformPreset } from "@/lib/ugc/options";
import { allowedDurations, coerceSettings } from "@/lib/ugc/render-settings";
import {
  ACTIVE_RENDER_STATUSES,
  BriefSchema,
  type AllowanceView,
  type Brief,
  type ModelView,
  type ProjectSummary,
  type ProjectView,
  type RenderView,
  type Script,
} from "@/lib/ugc/schemas";
import { scriptFromText, scriptToText } from "@/lib/ugc/script-text";
import { cn } from "@/lib/utils";
import {
  CreatorComposer,
  sameChoice,
  type BrandPerson,
  type ComposerProduct,
  type CreatorChoice,
  type CreatorDraft,
  type NewCreator,
} from "./CreatorComposer";
import { RenderPanel } from "./RenderPanel";
import { CreatorSilhouette, itemVariants, listVariants, RenderStatusChip } from "./ugc-ui";

type Catalog = { models: ModelView[]; defaultModel: string; allowance: AllowanceView };
type Tab = "create" | "videos";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof UgcApiError ? error.message : fallback;
}

export function UgcStudio({
  workspaceId,
  initialProjectId,
  source,
}: {
  workspaceId: string;
  initialProjectId?: string | null;
  source?: ScriptVideoSource | null;
}) {
  const [tab, setTab] = useState<Tab>("create");
  const [projectId, setProjectId] = useState<string | null>(initialProjectId ?? null);
  // A new composer per opened project (or a fresh one).
  const [session, setSession] = useState(0);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
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
  useEffect(() => loadCatalog(), [loadCatalog]);

  useEffect(() => {
    if (initialProjectId) setProjectId(initialProjectId);
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

  const open = (id: string | null) => {
    setProjectId(id);
    setSession((n) => n + 1);
    setTab("create");
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-center">
        <div
          role="tablist"
          aria-label="Creator videos"
          className="inline-flex rounded-full bg-[var(--ds-well-bg)] p-1"
        >
          {(
            [
              ["create", "Create"],
              ["videos", "Your videos"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-8 rounded-full px-4 text-xs font-medium transition-colors",
                tab === id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "videos" ? (
        <VideoList workspaceId={workspaceId} onNew={() => open(null)} onOpen={(id) => open(id)} />
      ) : (
        <VideoProject
          key={session}
          workspaceId={workspaceId}
          projectId={projectId}
          source={projectId ? null : source}
          catalog={catalog}
          refreshAllowance={loadCatalog}
          onCreated={setProjectId}
          onNew={() => open(null)}
        />
      )}
    </div>
  );
}

/* ── One video: the composer, or the render once it was started ───────── */

function VideoProject({
  workspaceId,
  projectId,
  source,
  catalog,
  refreshAllowance,
  onCreated,
  onNew,
}: {
  workspaceId: string;
  projectId: string | null;
  source?: ScriptVideoSource | null;
  catalog: Catalog | null;
  refreshAllowance: () => void;
  onCreated: (id: string) => void;
  onNew: () => void;
}) {
  const [project, setProject] = useState<ProjectView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeRender, setActiveRender] = useState<RenderView | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  // A project this screen just created is already in hand; never reload it over a started render.
  const createdHere = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId || projectId === createdHere.current) return;
    setLoadError(null);
    try {
      const p = await ugcApi.getProject(workspaceId, projectId);
      setProject(p);
      setActiveRender(
        p.renders.find((r) => ACTIVE_RENDER_STATUSES.includes(r.status)) ?? p.renders[0] ?? null,
      );
    } catch (e) {
      setLoadError(errorMessage(e, "Couldn't open this video."));
    }
  }, [workspaceId, projectId]);
  useEffect(() => {
    void load();
  }, [load]);

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

  const started = (p: ProjectView, render: RenderView) => {
    setProject({ ...p, renders: [render, ...p.renders.filter((r) => r.id !== render.id)] });
    setActiveRender(render);
    refreshAllowance();
  };

  const regenerate = async () => {
    if (!project || !activeRender || regenerating) return;
    setRegenerating(true);
    try {
      const { render } = await ugcApi.startRender(workspaceId, {
        projectId: project.id,
        idempotencyKey: crypto.randomUUID(),
        model: "auto",
        durationSec: activeRender.durationSec,
        aspectRatio: activeRender.aspectRatio,
        resolution: activeRender.resolution,
        referenceAssetIds: project.references.map((r) => r.assetId),
      });
      started(project, render);
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't start the video."));
    } finally {
      setRegenerating(false);
    }
  };

  if (loadError) {
    return (
      <ErrorState
        title="Couldn't open this video"
        description={loadError}
        onRetry={() => void load()}
      />
    );
  }
  if (projectId && !project) {
    return (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-[520px] rounded-[22px]" />
        <Skeleton className="h-[520px] rounded-[22px]" />
      </div>
    );
  }

  if (project && activeRender) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="min-w-0 truncate text-sm font-semibold">{project.title}</h3>
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-3 text-xs font-medium"
          >
            <Plus className="size-3.5" aria-hidden /> New video
          </button>
        </div>
        <RenderPanel
          key={activeRender.id}
          workspaceId={workspaceId}
          render={activeRender}
          script={project.script}
          history={project.renders}
          onSettled={onSettled}
          regenerating={regenerating}
          onRegenerate={() => void regenerate()}
          onEditSettings={() => setActiveRender(null)}
          onSelectRender={setActiveRender}
        />
      </div>
    );
  }

  return (
    <ComposerContainer
      workspaceId={workspaceId}
      project={project}
      source={source ?? null}
      catalog={catalog}
      onProject={(p) => {
        setProject(p);
        if (!projectId) {
          createdHere.current = p.id;
          onCreated(p.id);
        }
      }}
      onStarted={started}
    />
  );
}

/* ── The composer's data: Brand DNA products, the brand's people, suggestions ── */

const PERSON_NAME = "Your person";
const orderedCreators = creatorsInOrder(STOCK_CREATORS);

function ComposerContainer({
  workspaceId,
  project,
  source,
  catalog,
  onProject,
  onStarted,
}: {
  workspaceId: string;
  project: ProjectView | null;
  source: ScriptVideoSource | null;
  catalog: Catalog | null;
  onProject: (p: ProjectView) => void;
  onStarted: (p: ProjectView, render: RenderView) => void;
}) {
  const workspace = useWorkspace();
  const { dna, save } = useBrandDna(workspaceId);
  const look = useMemo(() => parseLook(dna.look), [dna.look]);
  const brandCreator: BrandCreatorRef | null = look.video?.creator ?? null;

  // What the Brand DNA scan already found: picked, never read again.
  const catalogue = useQuery({
    queryKey: ["workspace", workspaceId, "products", "ugc"],
    staleTime: 60_000,
    queryFn: () => listProducts({ data: { workspaceId } }),
  });
  // Creators made here this session, shown before the people list reloads.
  const [made, setMade] = useState<BrandPerson[]>([]);
  // The brand's own people (Inspo → Media, "Person").
  const visuals = useQuery({
    queryKey: ["workspace", workspaceId, "visual-taste", "ugc-people"],
    staleTime: 60_000,
    queryFn: () => getVisualTaste({ data: { workspaceId } }),
  });

  const people: BrandPerson[] = useMemo(
    () =>
      (visuals.data?.sources ?? [])
        .filter((s) => s.purpose === "person" && s.status !== "removed")
        .filter((s) => (s.asset?.mime_type ?? "image/").startsWith("image/"))
        .map((s): BrandPerson => ({
          assetId: s.asset_id,
          url: s.asset?.thumbnailUrl ?? s.asset?.url ?? null,
          name: s.label?.trim() || PERSON_NAME,
          fromSite: s.kind === "website",
        }))
        .concat(made.filter((m) => !visuals.data?.sources.some((s) => s.asset_id === m.assetId))),
    [visuals.data, made],
  );

  const products: ComposerProduct[] | null = useMemo(() => {
    if (catalogue.isPending) return project ? [currentProduct(project)] : null;
    const known = (catalogue.data ?? [])
      .filter((p) => p.status === "active")
      .map((item) => {
        const picked = ugcProductFromCatalogue(item, workspace.name);
        return {
          key: `cat:${item.id}`,
          name: item.name,
          imageUrl: picked.references[0]?.url ?? picked.product.images[0]?.url ?? null,
          product: picked.product,
          references: picked.references,
        };
      });
    if (!project) return known;
    const same = known.find((k) => k.name.trim() === project.product.name.trim());
    return same ? known : [currentProduct(project), ...known];
  }, [catalogue.isPending, catalogue.data, project, workspace.name]);

  const suggested = useMemo(
    () =>
      suggestCreators({
        industry: dna.industry,
        audience: dna.audience,
        audienceTags: dna.audienceTags,
        products: (catalogue.data ?? []).flatMap((p) => [p.name, p.category]),
      }),
    [dna.industry, dna.audience, dna.audienceTags, catalogue.data],
  );

  const model =
    catalog?.models.find((m) => m.key === catalog.defaultModel) ?? catalog?.models[0] ?? null;

  /* Draft ------------------------------------------------------------- */

  const baseScript = useRef<Script | null>(
    project?.script ?? (source ? toCreatorScript(source.script) : null),
  );
  const [draft, setDraft] = useState<CreatorDraft>(() => {
    const brief = project?.brief ?? (source ? creatorBrief(source) : BriefSchema.parse({}));
    return {
      creator: choiceFrom(brief) ?? choiceFromRef(brandCreator),
      productKey: project ? `project:${project.id}` : null,
      scriptText: scriptToText(baseScript.current),
      tone: brief.tone,
      setting: brief.creator.setting,
      platform: brief.platform,
      durationSec: brief.durationSec ?? platformPreset(brief.platform).durationSec,
    };
  });
  const patch = (p: Partial<CreatorDraft>) => setDraft((d) => ({ ...d, ...p }));

  // The brand's creator arrives with Brand DNA; use it until a person picks one.
  const pickedCreator = useRef(!!draft.creator);
  useEffect(() => {
    if (pickedCreator.current || !brandCreator) return;
    const choice = choiceFromRef(brandCreator);
    if (choice) setDraft((d) => (d.creator ? d : { ...d, creator: choice }));
  }, [brandCreator]);

  // First product by default; a catalogue twin of the project's product stands in for it.
  useEffect(() => {
    if (!products?.length) return;
    setDraft((d) =>
      d.productKey && products.some((p) => p.key === d.productKey)
        ? d
        : { ...d, productKey: products[0].key },
    );
  }, [products]);

  const product = products?.find((p) => p.key === draft.productKey) ?? null;
  const refIds = product?.references.map((r) => r.assetId) ?? [];
  const durations = model ? allowedDurations(model, refIds.length ? 1 : 0) : [5, 10, 15];
  useEffect(() => {
    if (!durations.includes(draft.durationSec)) {
      const nearest = durations.reduce((best, d) =>
        Math.abs(d - draft.durationSec) < Math.abs(best - draft.durationSec) ? d : best,
      );
      patch({ durationSec: nearest });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durations.join(","), draft.durationSec]);

  /* Actions ----------------------------------------------------------- */

  const [busy, setBusy] = useState<null | "write" | "generate">(null);
  const [current, setCurrent] = useState<ProjectView | null>(project);

  const brief = (): Brief => {
    const base = current?.brief ?? (source ? creatorBrief(source) : BriefSchema.parse({}));
    const stock = draft.creator?.kind === "stock" ? stockCreator(draft.creator.id) : null;
    const personAssetId = draft.creator?.kind === "person" ? draft.creator.assetId : undefined;
    const contentLanguage = LANGUAGES.find((l) => l.label === look.writing?.language)?.id;
    return BriefSchema.parse({
      ...base,
      platform: draft.platform,
      tone: draft.tone,
      durationSec: draft.durationSec,
      language: current ? base.language : (contentLanguage ?? base.language),
      audience: base.audience || product?.product.audienceHints[0] || "",
      creator: {
        ...base.creator,
        setting: draft.setting,
        gender: stock?.gender ?? base.creator.gender,
        age: stock?.age ?? base.creator.age,
        vibe: stock?.vibe ?? base.creator.vibe,
        characterId: stock?.id,
        personAssetId,
      },
    });
  };

  const creatorName = () =>
    draft.creator?.kind === "stock"
      ? (stockCreator(draft.creator.id)?.name ?? "")
      : draft.creator?.kind === "person"
        ? (people.find((p) => p.assetId === (draft.creator as { assetId: string }).assetId)?.name ??
          PERSON_NAME)
        : "";

  const saveProject = async (script: Script | null): Promise<ProjectView> => {
    if (!product) throw new UgcApiError(400, "Pick a product first.");
    const title = [product.product.name, creatorName()].filter(Boolean).join(" · ").slice(0, 200);
    const next = current
      ? await ugcApi.updateProject(workspaceId, current.id, {
          product: product.product,
          brief: brief(),
          referenceAssetIds: refIds,
          title,
          ...(script ? { script } : {}),
        })
      : await ugcApi.createProject(workspaceId, {
          product: product.product,
          brief: brief(),
          referenceAssetIds: refIds,
          title,
          script: script ?? undefined,
        });
    setCurrent(next);
    onProject(next);
    return next;
  };

  /** The script as typed; an untouched stored or written script keeps its shots. */
  const currentScript = (): Script | null => {
    const base = baseScript.current;
    if (base && scriptToText(base).trim() === draft.scriptText.trim()) return base;
    return scriptFromText(draft.scriptText, draft.durationSec, { cta: base?.cta });
  };

  const run = async (kind: "write" | "generate", fallback: string, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (e) {
      toast.error(errorMessage(e, fallback));
    } finally {
      setBusy(null);
    }
  };

  const write = () =>
    run("write", "Couldn't write ideas.", async () => {
      const p = await saveProject(null);
      const { project: next, warnings } = await ugcApi.generateConcepts(
        workspaceId,
        p.id,
        draft.durationSec,
      );
      setCurrent(next);
      onProject(next);
      const first = next.concepts[0];
      if (!first) return;
      baseScript.current = first.script;
      patch({ scriptText: scriptToText(first.script) });
      if (warnings.length) toast.message("Check the flagged lines before you generate.");
    });

  const pickIdea = (id: string) => {
    const concept = current?.concepts.find((c) => c.id === id);
    if (!concept) return;
    baseScript.current = concept.script;
    patch({ scriptText: scriptToText(concept.script) });
  };

  const generate = () =>
    run("generate", "Couldn't start the video.", async () => {
      if (!model) throw new UgcApiError(503, "Video models are still loading.");
      const script = currentScript();
      if (!script) throw new UgcApiError(400, "Write what the creator says first.");
      const p = await saveProject(script);
      const preset = platformPreset(draft.platform);
      const settings = coerceSettings(
        model,
        {
          model: model.key,
          durationSec: draft.durationSec,
          aspectRatio: preset.aspectRatio,
          resolution: model.defaultResolution,
          referenceIds: refIds,
        },
        preset.aspectRatio,
      );
      const { render } = await ugcApi.startRender(workspaceId, {
        projectId: p.id,
        idempotencyKey: crypto.randomUUID(),
        model: "auto",
        durationSec: settings.durationSec,
        aspectRatio: settings.aspectRatio,
        resolution: settings.resolution,
        referenceAssetIds: refIds,
      });
      onStarted(p, render);
    });

  const createCreator = async (input: NewCreator): Promise<boolean> => {
    try {
      const person = await ugcApi.createCreator(workspaceId, input);
      setMade((list) => [{ ...person }, ...list]);
      pickedCreator.current = true;
      patch({ creator: { kind: "person", assetId: person.assetId } });
      void visuals.refetch();
      toast.success(`${person.name} is ready. Make them your brand face to use them every time.`);
      return true;
    } catch (e) {
      toast.error(errorMessage(e, "Couldn't create that creator."));
      return false;
    }
  };

  const toggleBrandCreator = () => {
    if (!draft.creator) return;
    const isBrand = sameChoice(draft.creator, brandCreator);
    const ref: BrandCreatorRef =
      draft.creator.kind === "stock"
        ? { id: draft.creator.id, name: creatorName() }
        : { personAssetId: draft.creator.assetId, name: creatorName().slice(0, 60) };
    save({
      look: tidyLook({ ...look, video: { ...look.video, creator: isBrand ? undefined : ref } }),
    });
    toast.success(
      isBrand ? "Brand face removed" : `${creatorName()} is now your brand face for every video ad`,
    );
  };

  const videosLeft = catalog
    ? Math.max(
        0,
        catalog.allowance.videos.limit -
          catalog.allowance.videos.used -
          catalog.allowance.videos.held,
      )
    : null;

  return (
    <CreatorComposer
      draft={draft}
      onDraft={(p) => {
        if (p.creator) pickedCreator.current = true;
        patch(p);
      }}
      creators={orderedCreators}
      suggested={suggested}
      people={people}
      brandCreator={brandCreator}
      products={products}
      durations={durations}
      ideas={(current?.concepts ?? []).map((c) => ({ id: c.id, title: c.title }))}
      conceptPrice={creditsFor("ugc_concepts")}
      videosLeft={videosLeft}
      busy={busy}
      onWrite={() => void write()}
      onPickIdea={pickIdea}
      onGenerate={() => void generate()}
      onToggleBrandCreator={toggleBrandCreator}
      onAddProducts={() => emitAppEvent("open:brain", { section: "brand", tab: "products" })}
      onAddPeople={() => emitAppEvent("open:inspo", { section: "media" })}
      creatorPrice={creditsFor("image_standard")}
      onCreateCreator={createCreator}
    />
  );
}

function currentProduct(project: ProjectView): ComposerProduct {
  return {
    key: `project:${project.id}`,
    name: project.product.name || "Your product",
    imageUrl: project.references[0]?.url ?? project.product.images[0]?.url ?? null,
    product: project.product,
    references: project.references,
  };
}

function choiceFrom(brief: Brief): CreatorChoice | null {
  if (brief.creator.characterId) return { kind: "stock", id: brief.creator.characterId };
  if (brief.creator.personAssetId) return { kind: "person", assetId: brief.creator.personAssetId };
  return null;
}

function choiceFromRef(ref: BrandCreatorRef | null): CreatorChoice | null {
  if (ref?.id && stockCreator(ref.id)) return { kind: "stock", id: ref.id };
  if (ref?.personAssetId) return { kind: "person", assetId: ref.personAssetId };
  return null;
}

/* ── Your videos ──────────────────────────────────────────────────────── */

function VideoList({
  workspaceId,
  onNew,
  onOpen,
}: {
  workspaceId: string;
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
      .catch((e) => setError(errorMessage(e, "Couldn't load your videos.")));
  }, [workspaceId]);
  useEffect(() => load(), [load]);

  if (error)
    return (
      <ErrorState size="sm" title="Couldn't load your videos" description={error} onRetry={load} />
    );
  if (projects === null)
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="aspect-[9/16] rounded-[22px]" />
        ))}
      </div>
    );

  return (
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
          <span className="grid size-12 place-items-center rounded-full bg-primary/15 text-primary-ink transition-transform group-hover:scale-110">
            <Plus className="size-5" aria-hidden />
          </span>
          <span className="text-sm font-medium">New video</span>
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
                toast.error(errorMessage(e, "Couldn't archive that video."));
              }
            }}
          />
        </motion.li>
      ))}
    </motion.ul>
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
      <div className="relative aspect-[9/16] overflow-hidden rounded-[22px] bg-neutral-900 ring-1 ring-[var(--ds-tile-border)] transition-[transform,box-shadow] duration-300 group-hover:-translate-y-1">
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

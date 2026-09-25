"use client";
// BrandKitPanel — the Brand Kit surface.
//
// Styles (named looks and voices that every generator can follow) plus the
// library they draw on: logos, colours, fonts, elements, example posts and
// writing samples. Brand DNA stays the source of facts; a style can follow it
// field by field.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BrandKit,
  Copy,
  Brain,
  FileText,
  ImagePlus,
  Layers,
  MoreHorizontal,
  Palette,
  Plus,
  Sparkles,
  Star,
  Trash,
  Type,
  Wand,
} from "@/components/icons";
import {
  SurfaceLayout,
  SurfacePage,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { useAppEvent } from "@/hooks/use-app-event";
import { emitAppEvent } from "@/lib/app-events";
import type { BrandKitOverview, BrandStyleView, KitSection } from "@/lib/brand-kit/contracts";
import { STYLE_FORMAT_LABELS, specCompleteness } from "@/lib/brand-kit/spec";
import { useBrandKit, useStyleActions } from "./hooks";
import { PostPreview, Swatches, paletteList, resolveView, useStyleFonts } from "./preview";
import { StyleEditor } from "./StyleEditor";
import { CreateStyleFlow } from "./CreateStyleFlow";
import { LibrarySection } from "./LibrarySections";

type View =
  | { kind: "section"; section: KitSection }
  | { kind: "style"; styleId: string }
  | { kind: "create"; assetIds?: string[] };

export type BrandKitPanelProps = {
  workspaceId: string | null;
  initialStyleId?: string | null;
  initialSection?: string | null;
  startCreate?: boolean;
};

export function BrandKitPanel(props: BrandKitPanelProps) {
  if (!props.workspaceId) {
    return <EmptyState title="Select a workspace" description="Each brand has its own kit." />;
  }
  // Remount on switch, so no state from one brand ever survives into another.
  return <Panel key={props.workspaceId} {...props} workspaceId={props.workspaceId} />;
}

const SECTIONS: Array<{ id: KitSection; label: string; icon: SurfaceNavItem<string>["icon"] }> = [
  { id: "styles", label: "Styles", icon: BrandKit },
  { id: "logos", label: "Logos", icon: Star },
  { id: "colors", label: "Colors", icon: Palette },
  { id: "fonts", label: "Fonts", icon: Type },
  { id: "elements", label: "Elements", icon: Layers },
  { id: "inspiration", label: "Examples", icon: ImagePlus },
  { id: "writing", label: "Writing", icon: FileText },
];

function initialView(p: BrandKitPanelProps): View {
  if (p.startCreate) return { kind: "create" };
  if (p.initialStyleId) return { kind: "style", styleId: p.initialStyleId };
  const s = SECTIONS.find((x) => x.id === p.initialSection);
  return { kind: "section", section: s?.id ?? "styles" };
}

function Panel(props: BrandKitPanelProps & { workspaceId: string }) {
  const { workspaceId } = props;
  const [view, setView] = React.useState<View>(() => initialView(props));
  const overview = useBrandKit(workspaceId);
  const data = overview.data;

  // Deep links while the surface is already open.
  useAppEvent("open:brand-kit", (event) => {
    const detail = event.detail;
    if (detail?.create) setView({ kind: "create" });
    else if (detail?.styleId) setView({ kind: "style", styleId: detail.styleId });
    else if (detail?.section) {
      const s = SECTIONS.find((x) => x.id === detail.section);
      if (s) setView({ kind: "section", section: s.id });
    }
  });

  const counts = React.useMemo(() => countsFor(data), [data]);
  const navValue: KitSection | null =
    view.kind === "section"
      ? view.section
      : view.kind === "style" || view.kind === "create"
        ? "styles"
        : null;

  return (
    <SurfaceLayout
      label="Brand Kit"
      items={SECTIONS.map((s) => ({ ...s, count: counts[s.id] }))}
      value={navValue}
      onChange={(id) => setView({ kind: "section", section: id })}
      railTop={
        data?.canEdit ? (
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-10 w-full text-[13px]")}
            onClick={() => setView({ kind: "create" })}
          >
            <Plus className="h-4 w-4" /> New style
          </button>
        ) : null
      }
      railBottom={
        <button
          type="button"
          onClick={() => emitAppEvent("open:brand-dna", { tab: "essentials" })}
          className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
        >
          <Brain className="h-4 w-4" /> Brand DNA
        </button>
      }
    >
      {overview.isLoading ? (
        <SurfacePage title="Styles">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-[20px]" />
            ))}
          </div>
        </SurfacePage>
      ) : overview.isError || !data ? (
        <SurfacePage>
          <ErrorState
            title="Couldn't open your Brand Kit"
            detail={overview.error instanceof Error ? overview.error.message : null}
            onRetry={() => overview.refetch()}
          />
        </SurfacePage>
      ) : (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={
              view.kind === "section"
                ? view.section
                : view.kind === "style"
                  ? `s-${view.styleId}`
                  : "create"
            }
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
          >
            {view.kind === "create" ? (
              <CreateStyleFlow
                workspaceId={workspaceId}
                data={data}
                preselected={view.assetIds}
                onCancel={() => setView({ kind: "section", section: "styles" })}
                onCreated={(id) => setView({ kind: "style", styleId: id })}
              />
            ) : view.kind === "style" ? (
              <StyleEditor
                workspaceId={workspaceId}
                data={data}
                styleId={view.styleId}
                onBack={() => setView({ kind: "section", section: "styles" })}
              />
            ) : view.section === "styles" ? (
              <StylesGallery
                workspaceId={workspaceId}
                data={data}
                onOpen={(id) => setView({ kind: "style", styleId: id })}
                onCreate={() => setView({ kind: "create" })}
              />
            ) : (
              <LibrarySection
                workspaceId={workspaceId}
                data={data}
                section={view.section}
                onCreateFrom={(assetIds) => setView({ kind: "create", assetIds })}
                onOpenStyle={(id) => setView({ kind: "style", styleId: id })}
              />
            )}
          </motion.div>
        </AnimatePresence>
      )}
    </SurfaceLayout>
  );
}

function countsFor(data: BrandKitOverview | undefined): Partial<Record<KitSection, number>> {
  if (!data) return {};
  const by = (kinds: string[]) => data.assets.filter((a) => kinds.includes(a.kind)).length;
  return {
    styles: data.styles.filter((s) => !s.archived).length,
    logos: by(["logo", "logo_dark", "logo_mark"]),
    fonts: by(["font_file"]),
    elements: by(["element", "pattern", "product_photo"]),
    inspiration: by(["inspiration_image", "inspiration_video"]),
    writing: by(["writing_sample"]),
  };
}

// ── Styles gallery ──────────────────────────────────────────────────────────

function StylesGallery({
  workspaceId,
  data,
  onOpen,
  onCreate,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  onOpen: (id: string) => void;
  onCreate: () => void;
}) {
  const styles = data.styles.filter((s) => !s.archived);
  const logo = data.assets.find((a) => a.kind === "logo")?.url ?? data.dna.logoUrl;
  return (
    <SurfacePage
      title="Styles"
      subtitle="Pick one when you create, and everything follows it."
      actions={
        data.canEdit ? (
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px] md:hidden")}
            onClick={onCreate}
          >
            <Plus className="h-4 w-4" /> New style
          </button>
        ) : null
      }
    >
      {!styles.length ? (
        <EmptyState
          icon={Sparkles}
          title="No styles yet"
          description="Upload a few posts you love, or describe the look you want. Mellox learns it and uses it every time."
          action={
            data.canEdit ? (
              <button
                type="button"
                className={cn(dsPrimaryBtn, "h-10 px-5 text-[13px]")}
                onClick={onCreate}
              >
                <Wand className="h-4 w-4" /> Create your first style
              </button>
            ) : null
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {styles.map((style, i) => (
            <motion.div
              key={style.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.04, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <StyleCard
                workspaceId={workspaceId}
                style={style}
                data={data}
                logoUrl={logo}
                onOpen={() => onOpen(style.id)}
              />
            </motion.div>
          ))}
          {data.canEdit && (
            <button
              type="button"
              onClick={onCreate}
              className="ds-tile ds-tile-hover group flex min-h-[260px] flex-col items-center justify-center gap-3 border-dashed text-center"
            >
              <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/12 text-primary transition-transform duration-300 group-hover:scale-110">
                <Plus className="h-5 w-5" />
              </span>
              <span className="text-[14px] font-medium">New style</span>
              <span className="max-w-[220px] text-[12.5px] text-muted-foreground">
                From examples, a short description, or your Brand DNA.
              </span>
            </button>
          )}
        </div>
      )}
      <ArchivedStyles workspaceId={workspaceId} data={data} />
    </SurfacePage>
  );
}

function StyleCard({
  workspaceId,
  style,
  data,
  logoUrl,
  onOpen,
}: {
  workspaceId: string;
  style: BrandStyleView;
  data: BrandKitOverview;
  logoUrl: string | null;
  onOpen: () => void;
}) {
  const resolved = React.useMemo(() => resolveView(style, data.dna), [style, data.dna]);
  useStyleFonts(resolved, data.assets);
  const actions = useStyleActions(workspaceId);
  const done = Math.round(specCompleteness(style.spec) * 100);
  const learning = data.assets.some(
    (a) =>
      a.styleId === style.id &&
      (a.analysisStatus === "pending" || a.analysisStatus === "running") &&
      !a.stale,
  );
  const t = resolved.visual.typography ?? {};
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === "Enter" && onOpen()}
      className="ds-tile ds-tile-hover group relative flex cursor-pointer flex-col overflow-hidden p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
    >
      <div className="relative">
        {style.coverUrl ? (
          <div className="relative aspect-square overflow-hidden rounded-[18px]">
            <img
              src={style.coverUrl}
              alt=""
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
            />
            <div className="absolute bottom-2 right-2 w-[34%]">
              <PostPreview
                resolved={resolved}
                brandName={data.dna.brandName}
                logoUrl={logoUrl}
                className="shadow-lg"
              />
            </div>
          </div>
        ) : (
          <PostPreview
            resolved={resolved}
            brandName={data.dna.brandName}
            logoUrl={logoUrl}
            className="transition-transform duration-500 group-hover:scale-[1.015]"
          />
        )}
        {style.isDefault && (
          <span className="absolute left-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground shadow">
            <Star className="h-3 w-3" /> Default
          </span>
        )}
        {learning && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium shadow backdrop-blur">
            <Sparkles className="h-3 w-3 animate-pulse text-primary" /> Learning
          </span>
        )}
      </div>
      <div className="flex items-start justify-between gap-2 px-1.5 pb-1 pt-3">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">{style.name}</div>
          <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
            {[t.heading, t.body !== t.heading ? t.body : null].filter(Boolean).join(" · ") ||
              "Brand fonts"}
          </div>
        </div>
        {data.canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={dsIconBtn}
                aria-label="Style options"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={onOpen}>Edit</DropdownMenuItem>
              {!style.isDefault && (
                <DropdownMenuItem onClick={() => actions.makeDefault.mutate(style.id)}>
                  <Star className="mr-2 h-4 w-4" /> Make default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.duplicate.mutate(style.id)}>
                <Copy className="mr-2 h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => actions.toDna.mutate(style)}>
                <Brain className="mr-2 h-4 w-4" /> Copy colors and fonts to Brand DNA
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => actions.archive.mutate({ styleId: style.id, archived: true })}
              >
                <Trash className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 pt-1">
        <Swatches colors={paletteList(resolved)} />
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[11.5px] text-muted-foreground">
            {style.appliesTo.length
              ? style.appliesTo
                  .map((f) => STYLE_FORMAT_LABELS[f])
                  .slice(0, 2)
                  .join(", ") +
                (style.appliesTo.length > 2 ? ` +${style.appliesTo.length - 2}` : "")
              : "Everything"}
          </span>
          <CompletionRing value={done} />
        </div>
      </div>
    </div>
  );
}

function CompletionRing({ value }: { value: number }) {
  const r = 8;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative grid h-6 w-6 place-items-center" title={`${value}% filled in`}>
      <svg viewBox="0 0 20 20" className="h-6 w-6 -rotate-90">
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="var(--ds-well-bg-hover)"
          strokeWidth="2.5"
        />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - value / 100)}
          style={{ transition: "stroke-dashoffset 600ms var(--ds-ease)" }}
        />
      </svg>
    </span>
  );
}

function ArchivedStyles({ workspaceId, data }: { workspaceId: string; data: BrandKitOverview }) {
  const actions = useStyleActions(workspaceId);
  const archived = data.styles.filter((s) => s.archived);
  if (!archived.length) return null;
  return (
    <details className="mt-8">
      <summary className="ds-label cursor-pointer select-none">
        Archived ({archived.length})
      </summary>
      <div className="mt-3 flex flex-wrap gap-2">
        {archived.map((s) => (
          <span
            key={s.id}
            className="ds-well inline-flex items-center gap-2 py-1.5 pl-3.5 pr-1.5 text-[13px]"
          >
            {s.name}
            {data.canEdit && (
              <button
                type="button"
                className={cn(dsGhostBtn, "h-7 px-3 text-[12px]")}
                onClick={() => actions.archive.mutate({ styleId: s.id, archived: false })}
              >
                Restore
              </button>
            )}
          </span>
        ))}
      </div>
    </details>
  );
}

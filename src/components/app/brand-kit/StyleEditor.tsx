"use client";
// StyleEditor — edit one Style, with a live preview beside it.
//
// Changes save on their own (debounced, compare-and-set on the version), and
// every field a person touches is marked as theirs, so re-learning from
// examples never overwrites it.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Eye,
  ImagePlus,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Spinner,
  Star,
  Trash,
  Wand,
  X,
} from "@/components/icons";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { emitAppEvent } from "@/lib/app-events";
import type { BrandKitOverview, BrandStyleView, KitAssetView } from "@/lib/brand-kit/contracts";
import {
  STYLE_FORMATS,
  STYLE_FORMAT_LABELS,
  parseStyleSpec,
  type StyleFormat,
  type StyleSpec,
  type VideoStyle,
  type VisualStyle,
  type WritingStyle,
} from "@/lib/brand-kit/spec";
import { ANALYSIS_VERSION, applySuggestion, markUserEdited } from "@/lib/brand-kit/merge";
import { contrastRatio } from "@/lib/brand-kit/color";
import {
  useKitAssetActions,
  useStyleActions,
  useStylePromptPreview,
  useSuggestStyle,
  useUpdateStyle,
  useUploadKitFiles,
} from "./hooks";
import {
  ArticlePreview,
  PostPreview,
  SlidePreview,
  VideoPreview,
  resolveView,
  useStyleFonts,
} from "./preview";
import { PaletteEditor, type SwatchGroup } from "./ColorPicker";
import { MOODS, MatchControl, MoodChips, swatchGroups } from "./look";
import {
  ChipsInput,
  ColorField,
  DropZone,
  Field,
  FollowBrand,
  FontPicker,
  MoreOptions,
  Segmented,
  ToneSlider,
} from "./controls";

type Tab = "writing" | "look" | "video";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "look", label: "Look" },
  { id: "writing", label: "Writing" },
  { id: "video", label: "Video" },
];

type Draft = {
  name: string;
  description: string;
  appliesTo: StyleFormat[];
  spec: StyleSpec;
};

const SAVE_DELAY = 700;

export function StyleEditor({
  workspaceId,
  data,
  styleId,
  onBack,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  styleId: string;
  onBack: () => void;
}) {
  const style = data.styles.find((s) => s.id === styleId);
  if (!style) {
    return (
      <SurfacePage>
        <EmptyState
          title="This style isn't here any more"
          description="It may have been archived or removed."
          action={
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              onClick={onBack}
            >
              Back to styles
            </button>
          }
        />
      </SurfacePage>
    );
  }
  return (
    <Editor key={style.id} workspaceId={workspaceId} data={data} style={style} onBack={onBack} />
  );
}

function Editor({
  workspaceId,
  data,
  style,
  onBack,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  style: BrandStyleView;
  onBack: () => void;
}) {
  const canEdit = data.canEdit && !style.archived;
  const [tab, setTab] = React.useState<Tab>("look");
  const [draft, setDraft] = React.useState<Draft>(() => ({
    name: style.name,
    description: style.description ?? "",
    appliesTo: style.appliesTo,
    spec: parseStyleSpec(style.spec),
  }));
  const update = useUpdateStyle(workspaceId);
  const actions = useStyleActions(workspaceId);
  const version = React.useRef(style.version);
  const dirty = React.useRef(false);
  const [saveState, setSaveState] = React.useState<"saved" | "saving" | "error">("saved");

  // Keep in step with the server when nobody is typing here.
  React.useEffect(() => {
    if (dirty.current) return;
    version.current = style.version;
    setDraft({
      name: style.name,
      description: style.description ?? "",
      appliesTo: style.appliesTo,
      spec: parseStyleSpec(style.spec),
    });
  }, [style]);

  // Debounced autosave.
  React.useEffect(() => {
    if (!dirty.current) return;
    setSaveState("saving");
    const t = setTimeout(() => {
      update.mutate(
        {
          styleId: style.id,
          expectedVersion: version.current,
          name: draft.name.trim() || style.name,
          description: draft.description.trim() || null,
          appliesTo: draft.appliesTo,
          spec: draft.spec,
        },
        {
          onSuccess: (view) => {
            version.current = view.version;
            dirty.current = false;
            setSaveState("saved");
          },
          onError: () => {
            dirty.current = false;
            setSaveState("error");
          },
        },
      );
    }, SAVE_DELAY);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const edit = React.useCallback((fn: (d: Draft) => Draft) => {
    dirty.current = true;
    setDraft((d) => fn(d));
  }, []);

  /** Set one field of a section and mark it as the person's own. */
  const setField = React.useCallback(
    <S extends "writing" | "visual" | "video">(section: S, key: string, value: unknown) =>
      edit((d) => {
        const current = (d.spec[section] ?? {}) as Record<string, unknown>;
        const next = { ...current };
        if (value === undefined || value === "" || (Array.isArray(value) && !value.length))
          delete next[key];
        else next[key] = value;
        return {
          ...d,
          spec: markUserEdited({ ...d.spec, [section]: next }, [`${section}.${key}`]),
        };
      }),
    [edit],
  );

  type InheritKey = keyof NonNullable<StyleSpec["inherit"]>;
  const setInherit = (keys: InheritKey[], on: boolean) =>
    edit((d) => ({
      ...d,
      spec: {
        ...d.spec,
        inherit: { ...d.spec.inherit, ...Object.fromEntries(keys.map((k) => [k, on])) },
      },
    }));
  const follows = (keys: InheritKey[]) => keys.every((k) => draft.spec.inherit?.[k] !== false);

  const resolved = React.useMemo(
    () =>
      resolveView(
        { ...style, name: draft.name, spec: draft.spec, appliesTo: draft.appliesTo },
        data.dna,
      ),
    [style, draft, data.dna],
  );
  useStyleFonts(resolved, data.assets);
  const groups = React.useMemo(() => swatchGroups(data, draft.spec), [data, draft.spec]);

  const logoUrl = React.useMemo(() => {
    const variant = draft.spec.visual?.logo?.variant;
    const kit = variant ? data.assets.find((a) => a.kind === variant)?.url : null;
    return (
      kit ??
      (draft.spec.inherit?.logo !== false
        ? (data.assets.find((a) => a.kind === "logo")?.url ?? data.dna.logoUrl)
        : null)
    );
  }, [draft.spec, data.assets, data.dna.logoUrl]);

  return (
    <SurfacePage width="wide" className="pt-4">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className={dsIconBtn} aria-label="Back to styles">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <input
          value={draft.name}
          disabled={!canEdit}
          onChange={(e) => edit((d) => ({ ...d, name: e.target.value.slice(0, 80) }))}
          className="ds-page-title min-w-0 flex-1 rounded-[12px] bg-transparent px-2 py-1 outline-none transition-colors hover:bg-[var(--ds-well-bg)] focus:bg-[var(--ds-well-bg)]"
          aria-label="Style name"
        />
        <SaveBadge state={saveState} />
        {style.isDefault && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-[12.5px] font-medium">
            <Star className="h-3.5 w-3.5 text-primary" /> Default
          </span>
        )}
        <UseFor
          value={draft.appliesTo}
          disabled={!canEdit}
          onChange={(appliesTo) => edit((d) => ({ ...d, appliesTo }))}
        />
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={dsIconBtn} aria-label="Style options">
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {!style.isDefault && (
                <DropdownMenuItem onClick={() => actions.makeDefault.mutate(style.id)}>
                  <Star className="mr-2 h-4 w-4" /> Make default
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => actions.duplicate.mutate(style.id)}>
                <Copy className="mr-2 h-4 w-4" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => actions.toDna.mutate({ ...style, spec: draft.spec })}
              >
                <Brain className="mr-2 h-4 w-4" /> Copy to Brand DNA
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  actions.archive.mutate({ styleId: style.id, archived: true });
                  onBack();
                }}
              >
                <Trash className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <button
          type="button"
          className={cn(dsPrimaryBtn, "h-8 px-4 text-[12.5px]")}
          onClick={() => emitAppEvent("open:canvas", { type: "social", styleId: style.id })}
        >
          <Wand className="h-3.5 w-3.5" /> Try it
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {/* Tabs */}
          <div className="ds-well mb-5 inline-flex max-w-full gap-0.5 overflow-x-auto p-1 [scrollbar-width:none]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  "relative h-8 shrink-0 rounded-full px-4 text-[13px] font-medium transition-colors",
                  tab === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab === t.id && (
                  <motion.span
                    layoutId={`style-tab-${style.id}`}
                    className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-primary/25"
                    transition={{ type: "spring", stiffness: 420, damping: 36 }}
                  />
                )}
                <span className="relative">{t.label}</span>
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              {tab === "writing" && (
                <WritingTab
                  w={draft.spec.writing ?? {}}
                  followBrand={follows(["voice", "rules"])}
                  onFollowBrand={(on) => setInherit(["voice", "rules"], on)}
                  dnaVoice={data.dna.voice}
                  set={(k, v) => setField("writing", k, v)}
                  samples={
                    <WritingSamples
                      workspaceId={workspaceId}
                      styleId={style.id}
                      assets={data.assets}
                      disabled={!canEdit}
                    />
                  }
                  disabled={!canEdit}
                />
              )}
              {tab === "look" && (
                <LookTab
                  v={draft.spec.visual ?? {}}
                  followBrand={follows(["colors", "fonts", "logo"])}
                  onFollowBrand={(on) => setInherit(["colors", "fonts", "logo"], on)}
                  resolvedPalette={resolved.visual.palette}
                  resolvedFonts={resolved.visual.typography ?? {}}
                  assets={data.assets}
                  groups={groups}
                  set={(k, v) => setField("visual", k, v)}
                  examples={
                    <Examples
                      workspaceId={workspaceId}
                      style={style}
                      spec={draft.spec}
                      assets={data.assets}
                      disabled={!canEdit}
                      onSpec={(spec) => edit((d) => ({ ...d, spec }))}
                    />
                  }
                  note={draft.description}
                  onNote={(description) => edit((d) => ({ ...d, description }))}
                  disabled={!canEdit}
                />
              )}
              {tab === "video" && (
                <VideoTab
                  vid={draft.spec.video ?? {}}
                  set={(k, v) => setField("video", k, v)}
                  groups={groups}
                  disabled={!canEdit}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        <PreviewColumn
          workspaceId={workspaceId}
          styleId={style.id}
          resolved={resolved}
          brandName={data.dna.brandName}
          logoUrl={logoUrl}
          posterUrl={
            data.assets.find(
              (a) =>
                a.kind === "inspiration_video" &&
                draft.spec.references?.some((r) => r.assetId === a.id),
            )?.frameUrls[0]
          }
          saving={saveState === "saving"}
        />
      </div>
    </SurfacePage>
  );
}

function SaveBadge({ state }: { state: "saved" | "saving" | "error" }) {
  return (
    <span
      className={cn(
        "inline-flex h-8 w-8 items-center justify-center gap-1.5 text-[12px]",
        state === "error" ? "w-auto px-1 text-destructive" : "text-muted-foreground",
      )}
      aria-live="polite"
      title={state === "saving" ? "Saving" : state === "saved" ? "Saved" : undefined}
    >
      {state === "saving" ? (
        <Spinner className="h-3.5 w-3.5 animate-spin" />
      ) : state === "error" ? (
        <>Not saved</>
      ) : (
        <Check className="h-3.5 w-3.5 text-primary" />
      )}
      {state !== "error" && (
        <span className="sr-only">{state === "saving" ? "Saving" : "Saved"}</span>
      )}
    </span>
  );
}

/** What this style is used for, shown as its current value. */
function UseFor({
  value,
  onChange,
  disabled,
}: {
  value: StyleFormat[];
  onChange: (next: StyleFormat[]) => void;
  disabled: boolean;
}) {
  const label = value.length
    ? STYLE_FORMAT_LABELS[value[0]] + (value.length > 1 ? ` +${value.length - 1}` : "")
    : "Everything";
  const toggle = (f: StyleFormat) =>
    onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}>
          <span className="text-muted-foreground">For</span> {label}
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(320px,90vw)] rounded-[20px] p-3">
        <div className="ds-label mb-2.5">Use this style for</div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onChange([])}
            className={cn(
              "h-9 rounded-full px-4 text-[13px] font-medium transition-all",
              !value.length
                ? "bg-primary text-primary-foreground shadow-sm"
                : "ds-well text-muted-foreground hover:text-foreground",
            )}
          >
            Everything
          </button>
          {STYLE_FORMATS.map((f) => {
            const on = value.includes(f);
            return (
              <button
                key={f}
                type="button"
                aria-pressed={on}
                onClick={() => toggle(f)}
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-all",
                  on
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "ds-well text-muted-foreground hover:text-foreground",
                )}
              >
                {on && <Check className="h-3.5 w-3.5 text-primary" />}
                {STYLE_FORMAT_LABELS[f]}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Preview column ──────────────────────────────────────────────────────────

type PreviewKind = "post" | "slide" | "article" | "video";

function PreviewColumn({
  workspaceId,
  styleId,
  resolved,
  brandName,
  logoUrl,
  posterUrl,
  saving,
}: {
  workspaceId: string;
  styleId: string;
  resolved: ReturnType<typeof resolveView>;
  brandName: string | null;
  logoUrl: string | null;
  posterUrl?: string | null;
  saving: boolean;
}) {
  const [kind, setKind] = React.useState<PreviewKind>("post");
  const [showPrompt, setShowPrompt] = React.useState(false);
  const format: StyleFormat =
    kind === "article"
      ? "article"
      : kind === "video"
        ? "video"
        : kind === "slide"
          ? "carousel"
          : "social";
  const prompt = useStylePromptPreview(workspaceId, styleId, format, showPrompt && !saving);
  return (
    <aside className="lg:sticky lg:top-4 lg:self-start">
      <Tile className="p-3 sm:p-3">
        <div className="mb-3 flex justify-center">
          <Segmented
            size="sm"
            value={kind}
            onChange={(v) => v && setKind(v)}
            options={[
              { value: "post", label: "Post" },
              { value: "slide", label: "Slide" },
              { value: "article", label: "Article" },
              { value: "video", label: "Video" },
            ]}
          />
        </div>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={kind}
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.2 }}
            className={cn(
              kind === "video" && "mx-auto max-w-[200px]",
              kind === "slide" && "mx-auto max-w-[260px]",
            )}
          >
            {kind === "post" && (
              <PostPreview resolved={resolved} brandName={brandName} logoUrl={logoUrl} />
            )}
            {kind === "slide" && (
              <div className="grid grid-cols-2 gap-2">
                <SlidePreview resolved={resolved} index={1} />
                <SlidePreview resolved={resolved} index={2} />
              </div>
            )}
            {kind === "article" && <ArticlePreview resolved={resolved} brandName={brandName} />}
            {kind === "video" && <VideoPreview resolved={resolved} posterUrl={posterUrl} />}
          </motion.div>
        </AnimatePresence>
      </Tile>
      <button
        type="button"
        onClick={() => setShowPrompt((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-full px-4 py-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Eye className="h-4 w-4" /> What Mellox follows
        </span>
        <span>{showPrompt ? "Hide" : "Show"}</span>
      </button>
      <AnimatePresence initial={false}>
        {showPrompt && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="ds-well mt-2 max-h-[320px] overflow-y-auto whitespace-pre-wrap p-3 font-mono text-[11.5px] leading-relaxed text-foreground/80 scrollbar-thin">
              {prompt.isLoading || saving
                ? "Loading…"
                : [
                    prompt.data?.writing,
                    kind !== "article" ? prompt.data?.visual : "",
                    kind === "video" ? prompt.data?.video : "",
                  ]
                    .filter(Boolean)
                    .join("\n\n") || "Nothing set yet."}
              {!!prompt.data?.references &&
                `\n\n+ ${prompt.data.references} example image${prompt.data.references === 1 ? "" : "s"} sent with every picture.`}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

// ── Writing ─────────────────────────────────────────────────────────────────

const inputCls =
  "ds-well h-10 w-full px-4 text-[13.5px] outline-none placeholder:text-muted-foreground/70";
const areaCls =
  "ds-well w-full resize-none px-4 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/30";

function WritingTab({
  w,
  followBrand,
  onFollowBrand,
  dnaVoice,
  set,
  samples,
  disabled,
}: {
  w: WritingStyle;
  followBrand: boolean;
  onFollowBrand: (on: boolean) => void;
  dnaVoice: string | null;
  set: (key: keyof WritingStyle, value: unknown) => void;
  samples: React.ReactNode;
  disabled: boolean;
}) {
  const tone = w.tone ?? {};
  const setTone = (k: keyof NonNullable<WritingStyle["tone"]>, v: number) =>
    set("tone", { ...tone, [k]: v });
  const examples = w.examples ?? [];
  return (
    <div className="space-y-4">
      <Tile className="space-y-5">
        <Field
          label="Voice"
          hint={!w.voice && followBrand && dnaVoice ? "Using your Brand DNA voice" : undefined}
        >
          <textarea
            value={w.voice ?? ""}
            disabled={disabled}
            onChange={(e) => set("voice", e.target.value.slice(0, 600))}
            placeholder={
              followBrand && dnaVoice
                ? dnaVoice
                : "Friendly and direct. Short sentences. Talks like a founder, not a brand."
            }
            rows={3}
            className={areaCls}
          />
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
          <ToneSlider
            low="Formal"
            high="Casual"
            value={tone.casual}
            onChange={(v) => setTone("casual", v)}
            disabled={disabled}
          />
          <ToneSlider
            low="Serious"
            high="Playful"
            value={tone.playful}
            onChange={(v) => setTone("playful", v)}
            disabled={disabled}
          />
          <ToneSlider
            low="Short"
            high="Detailed"
            value={tone.detailed}
            onChange={(v) => setTone("detailed", v)}
            disabled={disabled}
          />
          <ToneSlider
            low="Quiet"
            high="Bold"
            value={tone.bold}
            onChange={(v) => setTone("bold", v)}
            disabled={disabled}
          />
        </div>
      </Tile>

      <Tile className="space-y-5">
        <Field label="Emoji">
          <Segmented
            value={w.emoji}
            disabled={disabled}
            onChange={(v) => set("emoji", v)}
            options={[
              { value: "none", label: "None" },
              { value: "light", label: "A few" },
              { value: "heavy", label: "Lots" },
            ]}
          />
        </Field>
        <Field label="Never use">
          <ChipsInput
            values={w.bannedWords ?? []}
            onChange={(v) => set("bannedWords", v)}
            placeholder="synergy, game-changer"
            max={30}
            disabled={disabled}
          />
        </Field>
        <Field label="A post that sounds right">
          <div className="space-y-2">
            {[0, 1, 2].map((i) =>
              i > examples.length ? null : (
                <textarea
                  key={i}
                  value={examples[i] ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...examples];
                    next[i] = e.target.value.slice(0, 800);
                    set(
                      "examples",
                      next.filter((x) => x.trim()),
                    );
                  }}
                  placeholder={i === 0 ? "Paste one here" : "Another one"}
                  rows={3}
                  className={areaCls}
                />
              ),
            )}
          </div>
        </Field>
      </Tile>

      <MoreOptions>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sentences">
            <Segmented
              value={w.sentenceLength}
              disabled={disabled}
              onChange={(v) => set("sentenceLength", v)}
              options={[
                { value: "short", label: "Short" },
                { value: "mixed", label: "Mixed" },
                { value: "long", label: "Long" },
              ]}
            />
          </Field>
          <Field label="Reading level">
            <Segmented
              value={w.readingLevel}
              disabled={disabled}
              onChange={(v) => set("readingLevel", v)}
              options={[
                { value: "simple", label: "Simple" },
                { value: "general", label: "General" },
                { value: "expert", label: "Expert" },
              ]}
            />
          </Field>
          <Field label="Speaks as">
            <Segmented
              value={w.person}
              disabled={disabled}
              onChange={(v) => set("person", v)}
              options={[
                { value: "we", label: "We" },
                { value: "i", label: "I" },
                { value: "you", label: "You" },
                { value: "brand", label: "Brand name" },
              ]}
            />
          </Field>
          <Field label="Capitals">
            <Segmented
              value={w.casing}
              disabled={disabled}
              onChange={(v) => set("casing", v)}
              options={[
                { value: "sentence", label: "Normal" },
                { value: "title", label: "Title Case" },
                { value: "lower", label: "lowercase" },
              ]}
            />
          </Field>
          <Field label="Line breaks">
            <Segmented
              value={w.formatting?.lineBreaks}
              disabled={disabled}
              onChange={(v) => set("formatting", { ...(w.formatting ?? {}), lineBreaks: v })}
              options={[
                { value: "dense", label: "Compact" },
                { value: "airy", label: "Airy" },
              ]}
            />
          </Field>
          <Field label="Hashtags per post">
            <input
              type="number"
              min={0}
              max={30}
              disabled={disabled}
              value={w.hashtags?.count ?? ""}
              placeholder="Auto"
              onChange={(e) =>
                set("hashtags", {
                  ...(w.hashtags ?? {}),
                  count:
                    e.target.value === ""
                      ? undefined
                      : Math.max(0, Math.min(30, Number(e.target.value))),
                })
              }
              className={cn(inputCls, "max-w-[140px]")}
            />
          </Field>
        </div>
        {w.emoji && w.emoji !== "none" && (
          <Field label="Favourite emoji">
            <ChipsInput
              values={w.favoriteEmoji ?? []}
              onChange={(v) => set("favoriteEmoji", v)}
              placeholder="✨ 🚀"
              max={8}
              disabled={disabled}
            />
          </Field>
        )}
        <Field label="Always use these hashtags">
          <ChipsInput
            prefix="#"
            values={w.hashtags?.always ?? []}
            onChange={(v) => set("hashtags", { ...(w.hashtags ?? {}), always: v })}
            placeholder="yourbrand"
            max={6}
            disabled={disabled}
          />
        </Field>
        <Field label="How posts open">
          <ChipsInput
            values={w.hooks ?? []}
            onChange={(v) => set("hooks", v)}
            placeholder="Start with a question"
            max={6}
            disabled={disabled}
          />
        </Field>
        <Field label="Call to action">
          <input
            value={w.cta ?? ""}
            disabled={disabled}
            onChange={(e) => set("cta", e.target.value.slice(0, 300))}
            placeholder="Soft invite to reply, never 'buy now'"
            className={inputCls}
          />
        </Field>
        <Field label="Phrases you use">
          <ChipsInput
            values={w.signaturePhrases ?? []}
            onChange={(v) => set("signaturePhrases", v)}
            placeholder="Ship it."
            max={8}
            disabled={disabled}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["social", "Note for posts", "Keep it under 3 lines"],
              ["article", "Note for articles", "Use a heading every 250 words"],
              ["script", "Note for video scripts", "Keep it under 3 lines"],
              ["ad", "Note for ads", "Lead with the result"],
            ] as const
          ).map(([f, label, ph]) => (
            <Field key={f} label={label}>
              <textarea
                value={w.perFormat?.[f] ?? ""}
                disabled={disabled}
                onChange={(e) =>
                  set("perFormat", {
                    ...(w.perFormat ?? {}),
                    [f]: e.target.value.slice(0, 400) || undefined,
                  })
                }
                rows={2}
                placeholder={ph}
                className={areaCls}
              />
            </Field>
          ))}
        </div>
        {samples}
        <FollowBrand on={followBrand} onChange={onFollowBrand} disabled={disabled} />
      </MoreOptions>
    </div>
  );
}

/** Writing samples saved with this style. Hidden when there are none. */
function WritingSamples({
  workspaceId,
  styleId,
  assets,
  disabled,
}: {
  workspaceId: string;
  styleId: string;
  assets: KitAssetView[];
  disabled: boolean;
}) {
  const assetActions = useKitAssetActions(workspaceId);
  const writing = assets.filter((a) => a.kind === "writing_sample" && a.styleId === styleId);
  if (!writing.length) return null;
  return (
    <Field label="Writing samples">
      <ul className="space-y-2">
        {writing.map((w) => (
          <li key={w.id} className="ds-well flex items-start gap-3 p-3">
            <AnalysisDot asset={w} />
            <div className="line-clamp-2 min-w-0 flex-1 text-[12.5px] text-foreground/85">
              {w.textContent}
            </div>
            {!disabled && (
              <button
                type="button"
                className={dsIconBtn}
                aria-label="Remove sample"
                onClick={() => assetActions.remove.mutate(w.id)}
              >
                <Trash className="h-4 w-4" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </Field>
  );
}

// ── Look ────────────────────────────────────────────────────────────────────

function LookTab({
  v,
  followBrand,
  onFollowBrand,
  resolvedPalette,
  resolvedFonts,
  assets,
  groups,
  set,
  examples,
  note,
  onNote,
  disabled,
}: {
  v: VisualStyle;
  followBrand: boolean;
  onFollowBrand: (on: boolean) => void;
  resolvedPalette: NonNullable<VisualStyle["palette"]>;
  resolvedFonts: NonNullable<VisualStyle["typography"]>;
  assets: KitAssetView[];
  groups: SwatchGroup[];
  set: (key: keyof VisualStyle, value: unknown) => void;
  examples: React.ReactNode;
  note: string;
  onNote: (note: string) => void;
  disabled: boolean;
}) {
  const palette = v.palette ?? {};
  const t = v.typography ?? {};
  const textOn = palette.text ?? resolvedPalette.text;
  const bgOn = palette.background ?? resolvedPalette.background;
  const hardToRead = !!textOn && !!bgOn && contrastRatio(textOn, bgOn) < 3;
  const uploadedFonts = assets
    .filter((a) => a.kind === "font_file")
    .map((a) => ({ id: a.id, family: a.label ?? "Custom font" }));
  const logos = assets.filter(
    (a) => a.kind === "logo" || a.kind === "logo_dark" || a.kind === "logo_mark",
  );
  const setFont = (role: "heading" | "body", family: string | undefined, fileId?: string) => {
    const files = { ...(t.files ?? {}) };
    if (fileId) files[role] = fileId;
    else delete files[role];
    set("typography", {
      ...t,
      [role]: family,
      files: Object.keys(files).length ? files : undefined,
    });
  };
  return (
    <div className="space-y-4">
      {examples}

      <Tile className="space-y-5">
        <Field
          label="Colors"
          hint={hardToRead ? "Text is hard to read on this background" : undefined}
        >
          <PaletteEditor
            palette={palette}
            fallback={resolvedPalette}
            groups={groups}
            disabled={disabled}
            onChange={(next) => set("palette", next)}
          />
        </Field>
        <Field label="Fonts">
          <div className="grid gap-3 sm:grid-cols-2">
            <FontPicker
              value={t.heading ?? resolvedFonts.heading}
              uploaded={uploadedFonts}
              disabled={disabled}
              placeholder="Headline font"
              sampleText="Big bold headline"
              onChange={(fam, id) => setFont("heading", fam, id)}
            />
            <FontPicker
              value={t.body ?? resolvedFonts.body}
              uploaded={uploadedFonts}
              disabled={disabled}
              placeholder="Text font"
              sampleText="Easy to read at any size"
              onChange={(fam, id) => setFont("body", fam, id)}
            />
          </div>
        </Field>
      </Tile>

      <Tile className="space-y-5">
        <Field label="Mood">
          <MoodChips value={v.mood} onChange={(m) => set("mood", m)} disabled={disabled} />
        </Field>
        <Field label="Kind of image">
          <Segmented
            value={v.medium}
            disabled={disabled}
            onChange={(m) => set("medium", m)}
            options={[
              { value: "photo", label: "Photo" },
              { value: "illustration", label: "Illustration" },
              { value: "3d", label: "3D" },
              { value: "flat", label: "Flat graphic" },
              { value: "typographic", label: "Type only" },
              { value: "collage", label: "Collage" },
            ]}
          />
        </Field>
      </Tile>

      <MoreOptions>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Text on images">
            <Segmented
              value={v.textPlacement}
              disabled={disabled}
              onChange={(p) => set("textPlacement", p)}
              options={[
                { value: "top", label: "Top" },
                { value: "center", label: "Middle" },
                { value: "bottom", label: "Bottom" },
                { value: "none", label: "No text" },
              ]}
            />
          </Field>
          <Field label="Space">
            <Segmented
              value={v.whitespace}
              disabled={disabled}
              onChange={(p) => set("whitespace", p)}
              options={[
                { value: "minimal", label: "Full" },
                { value: "balanced", label: "Balanced" },
                { value: "generous", label: "Airy" },
              ]}
            />
          </Field>
          <Field label="Headline weight">
            <Segmented
              value={t.headingWeight ? String(t.headingWeight) : undefined}
              disabled={disabled}
              onChange={(w) =>
                set("typography", { ...t, headingWeight: w ? Number(w) : undefined })
              }
              options={[
                { value: "400", label: "Regular" },
                { value: "600", label: "Semi" },
                { value: "700", label: "Bold" },
                { value: "800", label: "Heavy" },
              ]}
            />
          </Field>
          <Field label="Headline letters">
            <Segmented
              value={t.casing}
              disabled={disabled}
              onChange={(c) => set("typography", { ...t, casing: c })}
              options={[
                { value: "as-written", label: "As written" },
                { value: "upper", label: "CAPS" },
                { value: "lower", label: "lower" },
              ]}
            />
          </Field>
        </div>
        {v.textPlacement !== "none" && (
          <Field label={`Words on an image: up to ${v.textOnImage?.maxWords ?? 6}`}>
            <input
              type="range"
              min={1}
              max={14}
              value={v.textOnImage?.maxWords ?? 6}
              disabled={disabled}
              onChange={(e) =>
                set("textOnImage", { ...(v.textOnImage ?? {}), maxWords: Number(e.target.value) })
              }
              className="w-full accent-[hsl(var(--primary))]"
            />
          </Field>
        )}
        <Field
          label="Logo on images"
          aside={
            <Switch
              checked={v.logo?.use !== false}
              disabled={disabled}
              onCheckedChange={(on) => set("logo", { ...(v.logo ?? {}), use: on })}
              aria-label="Show logo"
            />
          }
        >
          {v.logo?.use !== false && (
            <div className="flex flex-wrap gap-3">
              <Segmented
                value={v.logo?.corner}
                disabled={disabled}
                onChange={(c) => set("logo", { ...(v.logo ?? {}), corner: c })}
                options={[
                  { value: "top-left", label: "↖" },
                  { value: "top-right", label: "↗" },
                  { value: "bottom-left", label: "↙" },
                  { value: "bottom-right", label: "↘" },
                ]}
              />
              {logos.length > 1 && (
                <Segmented
                  value={v.logo?.variant}
                  disabled={disabled}
                  onChange={(x) => set("logo", { ...(v.logo ?? {}), variant: x })}
                  options={[
                    ...(logos.some((l) => l.kind === "logo")
                      ? [{ value: "logo" as const, label: "Main" }]
                      : []),
                    ...(logos.some((l) => l.kind === "logo_dark")
                      ? [{ value: "logo_dark" as const, label: "For dark" }]
                      : []),
                    ...(logos.some((l) => l.kind === "logo_mark")
                      ? [{ value: "logo_mark" as const, label: "Icon" }]
                      : []),
                  ]}
                />
              )}
            </div>
          )}
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["mood", "Mood in your words", "Warm, calm, optimistic"],
              ["lighting", "Light", "Soft daylight from the side"],
              ["grading", "Color feel", "Muted, slightly warm film look"],
              ["texture", "Texture", "Clean, a little paper grain"],
              ["background", "Background", "Solid cream, no gradient"],
              ["composition", "Layout", "Picture left, headline at the bottom"],
            ] as const
          ).map(([key, label, ph]) => (
            <Field key={key} label={label}>
              <input
                value={
                  key === "mood" && MOODS.some((m) => m.value === v.mood)
                    ? ""
                    : ((v[key] as string | undefined) ?? "")
                }
                disabled={disabled}
                onChange={(e) =>
                  set(key, e.target.value.slice(0, key === "composition" ? 300 : 160))
                }
                placeholder={ph}
                className={inputCls}
              />
            </Field>
          ))}
        </div>
        <Field label="Shapes and details">
          <ChipsInput
            values={v.elements ?? []}
            onChange={(x) => set("elements", x)}
            placeholder="Rounded cards, thin outline icons"
            max={8}
            disabled={disabled}
          />
        </Field>
        <Field label="Never do">
          <ChipsInput
            values={v.avoid ?? []}
            onChange={(x) => set("avoid", x)}
            placeholder="Stock photos, neon"
            max={12}
            disabled={disabled}
          />
        </Field>
        <Field label="Note for your team">
          <input
            value={note}
            disabled={disabled}
            onChange={(e) => onNote(e.target.value.slice(0, 400))}
            placeholder="For launches and big announcements"
            className={inputCls}
          />
        </Field>
        <FollowBrand on={followBrand} onChange={onFollowBrand} disabled={disabled} />
      </MoreOptions>
    </div>
  );
}

// ── Video ───────────────────────────────────────────────────────────────────

function VideoTab({
  vid,
  set,
  groups,
  disabled,
}: {
  vid: VideoStyle;
  set: (key: keyof VideoStyle, value: unknown) => void;
  groups: SwatchGroup[];
  disabled: boolean;
}) {
  const cap = vid.captions ?? {};
  return (
    <div className="space-y-4">
      <Tile className="space-y-5">
        <Field label="Pace">
          <Segmented
            value={vid.pacing}
            disabled={disabled}
            onChange={(p) => set("pacing", p)}
            options={[
              { value: "slow", label: "Slow" },
              { value: "steady", label: "Steady" },
              { value: "fast", label: "Fast cuts" },
            ]}
          />
        </Field>
        <Field
          label="Captions"
          aside={
            <Switch
              checked={cap.show !== false}
              disabled={disabled}
              onCheckedChange={(on) => set("captions", { ...cap, show: on })}
              aria-label="Show captions"
            />
          }
        >
          {cap.show !== false && (
            <Segmented
              value={cap.position}
              disabled={disabled}
              onChange={(p) => set("captions", { ...cap, position: p })}
              options={[
                { value: "top", label: "Top" },
                { value: "center", label: "Middle" },
                { value: "bottom", label: "Bottom" },
              ]}
            />
          )}
        </Field>
      </Tile>
      <MoreOptions>
        {cap.show !== false && (
          <Field label="Caption font and colors">
            <div className="space-y-3">
              <FontPicker
                value={cap.font}
                disabled={disabled}
                sampleText="This is how it looks"
                onChange={(f) => set("captions", { ...cap, font: f })}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <ColorField
                  label="Text"
                  value={cap.color}
                  groups={groups}
                  disabled={disabled}
                  onChange={(h) => set("captions", { ...cap, color: h })}
                  onClear={() => set("captions", { ...cap, color: undefined })}
                />
                <ColorField
                  label="Highlight"
                  value={cap.highlight}
                  groups={groups}
                  disabled={disabled}
                  onChange={(h) => set("captions", { ...cap, highlight: h })}
                  onClear={() => set("captions", { ...cap, highlight: undefined })}
                />
              </div>
            </div>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["hook", "First seconds", "Start on the result, then show how"],
              ["shots", "Shots", "Handheld close-ups, one wide shot"],
              ["transitions", "Cuts", "Quick jump cuts on the beat"],
              ["music", "Music feel", "Upbeat lo-fi"],
              ["intro", "Opening", "No logo intro"],
              ["outro", "Ending", "Logo on brand color for one second"],
            ] as const
          ).map(([key, label, ph]) => (
            <Field key={key} label={label}>
              <input
                value={(vid[key] as string | undefined) ?? ""}
                disabled={disabled}
                onChange={(e) => set(key, e.target.value.slice(0, 200))}
                placeholder={ph}
                className={inputCls}
              />
            </Field>
          ))}
        </div>
      </MoreOptions>
    </div>
  );
}

// ── Examples this style copies ──────────────────────────────────────────────

function Examples({
  workspaceId,
  style,
  spec,
  assets,
  disabled,
  onSpec,
}: {
  workspaceId: string;
  style: BrandStyleView;
  spec: StyleSpec;
  assets: KitAssetView[];
  disabled: boolean;
  onSpec: (spec: StyleSpec) => void;
}) {
  const upload = useUploadKitFiles(workspaceId);
  const assetActions = useKitAssetActions(workspaceId);
  const suggest = useSuggestStyle(workspaceId);
  const [picking, setPicking] = React.useState(false);
  const [waiting, setWaiting] = React.useState(false);
  const refs = spec.references ?? [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  const attached = refs.map((r) => byId.get(r.assetId)).filter(Boolean) as KitAssetView[];
  const writing = assets.filter((a) => a.kind === "writing_sample" && a.styleId === style.id);
  const library = assets.filter(
    (a) =>
      (a.kind === "inspiration_image" || a.kind === "inspiration_video") &&
      !refs.some((r) => r.assetId === a.id),
  );
  const learnIds = [...attached.map((a) => a.id), ...writing.map((w) => w.id)];
  const setRefs = (next: typeof refs) => onSpec({ ...spec, references: next });

  const onUpload = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    const ids: string[] = [];
    if (images.length)
      ids.push(
        ...(
          await upload.mutateAsync({ kind: "inspiration_image", files: images, styleId: style.id })
        ).ids,
      );
    if (videos.length)
      ids.push(
        ...(
          await upload.mutateAsync({ kind: "inspiration_video", files: videos, styleId: style.id })
        ).ids,
      );
    if (ids.length)
      setRefs(
        [...refs, ...ids.map((assetId) => ({ assetId, strength: "close" as const }))].slice(0, 12),
      );
  };

  const apply = () =>
    suggest.mutate(learnIds, {
      onSuccess: (s) => onSpec(applySuggestion(spec, s.spec)),
    });
  const reading = [...attached, ...writing].some(
    (a) => (a.analysisStatus === "pending" || a.analysisStatus === "running") && !a.stale,
  );
  // Examples read by the older, thinner reader are read again first.
  const outdated = attached.filter(
    (a) => a.analysisStatus === "done" && (a.analysis?.v ?? 1) < ANALYSIS_VERSION,
  );
  const relearn = () => {
    if (!outdated.length && !reading) return apply();
    setWaiting(true);
    if (outdated.length)
      assetActions.reanalyze.mutate(
        { assetIds: outdated.map((a) => a.id), refresh: true },
        { onError: () => setWaiting(false) },
      );
  };
  React.useEffect(() => {
    if (!waiting || reading || outdated.length || assetActions.reanalyze.isPending) return;
    setWaiting(false);
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting, reading, outdated.length, assetActions.reanalyze.isPending]);
  const busy = waiting || suggest.isPending;

  if (disabled && !attached.length) return null;
  return (
    <Tile className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[13px] font-medium">Examples</div>
        {!disabled && learnIds.length > 0 && (
          <button
            type="button"
            className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
            onClick={relearn}
            disabled={busy}
          >
            {busy ? (
              <Spinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {busy ? "Reading" : "Update style"}
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
        {attached.map((asset) => (
          <div key={asset.id} className="group relative">
            <ExampleThumb asset={asset} />
            {!disabled && (
              <button
                type="button"
                aria-label="Remove example"
                onClick={() => setRefs(refs.filter((r) => r.assetId !== asset.id))}
                className="absolute right-1.5 top-1.5 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/75 focus-visible:opacity-100 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {!disabled && (
          <DropZone
            compact
            accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
            onFiles={onUpload}
            busy={upload.isPending}
            icon={ImagePlus}
            title="Add"
            className="aspect-square min-h-0 rounded-[14px] p-2"
          />
        )}
      </div>
      {(attached.length > 0 || (!disabled && library.length > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {attached.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] text-muted-foreground">Copy them</span>
              <MatchControl references={refs} onChange={setRefs} disabled={disabled} />
            </div>
          ) : (
            <span />
          )}
          {!disabled && library.length > 0 && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
              onClick={() => setPicking((p) => !p)}
            >
              <Plus className="h-3.5 w-3.5" /> From your kit
            </button>
          )}
        </div>
      )}
      <AnimatePresence>
        {picking && library.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {library.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="rounded-[14px] transition-transform hover:scale-[1.02]"
                  onClick={() =>
                    setRefs([...refs, { assetId: a.id, strength: "close" as const }].slice(0, 12))
                  }
                >
                  <ExampleThumb asset={a} />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Tile>
  );
}

export function AnalysisDot({ asset }: { asset: KitAssetView }) {
  const s = asset.stale ? "failed" : asset.analysisStatus;
  const cls =
    s === "done"
      ? "bg-primary"
      : s === "failed"
        ? "bg-destructive"
        : s === "none"
          ? "bg-muted-foreground/30"
          : "animate-pulse bg-primary/60";
  const label =
    s === "done"
      ? "Learned"
      : s === "failed"
        ? (asset.analysisError ?? "Couldn't read this")
        : s === "none"
          ? ""
          : "Reading…";
  return <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", cls)} title={label} />;
}

export function ExampleThumb({ asset, className }: { asset: KitAssetView; className?: string }) {
  const working =
    (asset.analysisStatus === "pending" || asset.analysisStatus === "running") && !asset.stale;
  const src = asset.kind === "inspiration_video" ? (asset.frameUrls[0] ?? null) : asset.url;
  return (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-[14px] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]",
        working && "ds-scan",
        className,
      )}
      style={{ ["--ds-scan-h" as string]: "100%" }}
    >
      {src ? (
        <img
          src={src}
          alt={asset.label ?? ""}
          className="h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="grid h-full place-items-center text-[11px] text-muted-foreground">
          Video
        </div>
      )}
      {asset.kind === "inspiration_video" && (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Video
        </span>
      )}
      {asset.analysisStatus === "done" && asset.analysis?.colors?.length ? (
        <div className="absolute bottom-1.5 left-1.5 flex">
          {asset.analysis.colors.slice(0, 4).map((c, i) => (
            <span
              key={i}
              className="h-3.5 w-3.5 rounded-full ring-2 ring-white"
              style={{ background: c, marginLeft: i ? -4 : 0 }}
            />
          ))}
        </div>
      ) : null}
      {asset.analysisStatus === "failed" || asset.stale ? (
        <span className="absolute bottom-1.5 right-1.5 rounded-full bg-destructive/90 px-1.5 py-0.5 text-[10px] font-medium text-white">
          Retry
        </span>
      ) : null}
    </div>
  );
}

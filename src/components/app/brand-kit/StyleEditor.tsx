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
import {
  ArrowLeft,
  Brain,
  Check,
  Eye,
  ImagePlus,
  Plus,
  RefreshCw,
  Sparkles,
  Spinner,
  Star,
  Trash,
  Wand,
  X,
} from "@/components/icons";
import { SurfacePage, Tile, GroupLabel } from "@/components/app/surface/SurfaceLayout";
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
import { applySuggestion, markUserEdited } from "@/lib/brand-kit/merge";
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
import {
  ChipsInput,
  ColorField,
  DropZone,
  Field,
  FontPicker,
  LinkedToggle,
  Segmented,
  ToneSlider,
} from "./controls";

type Tab = "writing" | "look" | "video" | "examples" | "use";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "writing", label: "Writing" },
  { id: "look", label: "Look" },
  { id: "video", label: "Video" },
  { id: "examples", label: "Examples" },
  { id: "use", label: "Use for" },
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
  const [tab, setTab] = React.useState<Tab>("writing");
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

  const setInherit = (key: keyof NonNullable<StyleSpec["inherit"]>, on: boolean) =>
    edit((d) => ({ ...d, spec: { ...d.spec, inherit: { ...d.spec.inherit, [key]: on } } }));

  const resolved = React.useMemo(
    () =>
      resolveView(
        { ...style, name: draft.name, spec: draft.spec, appliesTo: draft.appliesTo },
        data.dna,
      ),
    [style, draft, data.dna],
  );
  useStyleFonts(resolved, data.assets);

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
        {style.isDefault ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/12 px-3 text-[12.5px] font-medium">
            <Star className="h-3.5 w-3.5 text-primary" /> Default
          </span>
        ) : (
          canEdit && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
              onClick={() => actions.makeDefault.mutate(style.id)}
            >
              <Star className="h-3.5 w-3.5" /> Make default
            </button>
          )
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
                  inheritVoice={draft.spec.inherit?.voice !== false}
                  inheritRules={draft.spec.inherit?.rules !== false}
                  dnaVoice={data.dna.voice}
                  set={(k, v) => setField("writing", k, v)}
                  setInherit={setInherit}
                  disabled={!canEdit}
                />
              )}
              {tab === "look" && (
                <LookTab
                  v={draft.spec.visual ?? {}}
                  inheritColors={draft.spec.inherit?.colors !== false}
                  inheritFonts={draft.spec.inherit?.fonts !== false}
                  inheritLogo={draft.spec.inherit?.logo !== false}
                  resolvedPalette={resolved.visual.palette}
                  resolvedFonts={resolved.visual.typography ?? {}}
                  assets={data.assets}
                  set={(k, v) => setField("visual", k, v)}
                  setInherit={setInherit}
                  disabled={!canEdit}
                />
              )}
              {tab === "video" && (
                <VideoTab
                  vid={draft.spec.video ?? {}}
                  set={(k, v) => setField("video", k, v)}
                  disabled={!canEdit}
                />
              )}
              {tab === "examples" && (
                <ExamplesTab
                  workspaceId={workspaceId}
                  style={style}
                  spec={draft.spec}
                  assets={data.assets}
                  disabled={!canEdit}
                  onSpec={(spec) => edit((d) => ({ ...d, spec }))}
                />
              )}
              {tab === "use" && (
                <UseTab
                  draft={draft}
                  style={style}
                  disabled={!canEdit}
                  onChange={(patch) => edit((d) => ({ ...d, ...patch }))}
                  onArchive={() => {
                    actions.archive.mutate({ styleId: style.id, archived: true });
                    onBack();
                  }}
                  onDuplicate={() => actions.duplicate.mutate(style.id)}
                  onToDna={() => actions.toDna.mutate({ ...style, spec: draft.spec })}
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
        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12px] transition-colors",
        state === "error" ? "text-destructive" : "text-muted-foreground",
      )}
      aria-live="polite"
    >
      {state === "saving" ? (
        <>
          <Spinner className="h-3.5 w-3.5 animate-spin" /> Saving
        </>
      ) : state === "error" ? (
        <>Not saved</>
      ) : (
        <>
          <Check className="h-3.5 w-3.5 text-primary" /> Saved
        </>
      )}
    </span>
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
        <div className="mb-3 flex items-center justify-between gap-2 px-1">
          <span className="ds-label">Preview</span>
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
        <p className="mt-3 px-1 text-[11.5px] leading-relaxed text-muted-foreground">
          A sketch of the look. Real content uses your images and words.
        </p>
      </Tile>
      <button
        type="button"
        onClick={() => setShowPrompt((v) => !v)}
        className="mt-3 flex w-full items-center justify-between rounded-full px-4 py-2.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg)] hover:text-foreground"
      >
        <span className="inline-flex items-center gap-2">
          <Eye className="h-4 w-4" /> What the AI sees
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
                    .join("\n\n") || "Nothing set yet. Fill in a few fields and it shows up here."}
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

function WritingTab({
  w,
  inheritVoice,
  inheritRules,
  dnaVoice,
  set,
  setInherit,
  disabled,
}: {
  w: WritingStyle;
  inheritVoice: boolean;
  inheritRules: boolean;
  dnaVoice: string | null;
  set: (key: keyof WritingStyle, value: unknown) => void;
  setInherit: (key: "voice" | "rules", on: boolean) => void;
  disabled: boolean;
}) {
  const tone = w.tone ?? {};
  const setTone = (k: keyof NonNullable<WritingStyle["tone"]>, v: number) =>
    set("tone", { ...tone, [k]: v });
  return (
    <div className="space-y-4">
      <Tile className="space-y-5">
        <Field
          label="Voice"
          hint={
            !w.voice && inheritVoice && dnaVoice
              ? "Using your Brand DNA voice"
              : "How it should sound, in a sentence or two"
          }
          aside={
            <LinkedToggle
              on={inheritVoice}
              onChange={(on) => setInherit("voice", on)}
              disabled={disabled}
            />
          }
        >
          <textarea
            value={w.voice ?? ""}
            disabled={disabled}
            onChange={(e) => set("voice", e.target.value.slice(0, 600))}
            placeholder={
              inheritVoice && dnaVoice
                ? dnaVoice
                : "Friendly and direct. Short sentences. Talks like a founder, not a brand."
            }
            rows={3}
            className="ds-well w-full resize-none px-4 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/30"
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

      <Tile className="grid gap-5 sm:grid-cols-2">
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
        {w.emoji && w.emoji !== "none" && (
          <Field label="Favourite emoji" className="sm:col-span-2">
            <ChipsInput
              values={w.favoriteEmoji ?? []}
              onChange={(v) => set("favoriteEmoji", v)}
              placeholder="Add emoji, like ✨ or 🚀"
              max={8}
              disabled={disabled}
            />
          </Field>
        )}
      </Tile>

      <Tile className="space-y-5">
        <div className="grid gap-5 sm:grid-cols-[160px_1fr]">
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
              className="ds-well h-10 w-full px-4 text-[13.5px] outline-none"
            />
          </Field>
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
        </div>
        <Field label="How posts open" hint="Patterns, not exact lines">
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
            className="ds-well h-10 w-full px-4 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
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
        <Field label="Never use">
          <ChipsInput
            values={w.bannedWords ?? []}
            onChange={(v) => set("bannedWords", v)}
            placeholder="synergy, game-changer"
            max={30}
            disabled={disabled}
          />
        </Field>
      </Tile>

      <Tile className="space-y-4">
        <Field
          label="Example writing"
          hint="Up to three short pieces in this style. Mellox copies the rhythm, never the facts."
          aside={
            <LinkedToggle
              on={inheritRules}
              onChange={(on) => setInherit("rules", on)}
              disabled={disabled}
            />
          }
        >
          <div className="space-y-2">
            {[0, 1, 2].map((i) => {
              const list = w.examples ?? [];
              if (i > list.length) return null;
              return (
                <textarea
                  key={i}
                  value={list[i] ?? ""}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = [...list];
                    next[i] = e.target.value.slice(0, 800);
                    set(
                      "examples",
                      next.filter((x) => x.trim()),
                    );
                  }}
                  placeholder={
                    i === 0 ? "Paste a post that sounds exactly right" : "Another one (optional)"
                  }
                  rows={3}
                  className="ds-well w-full resize-none px-4 py-3 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
                />
              );
            })}
          </div>
        </Field>
        <details className="group">
          <summary className="cursor-pointer select-none text-[13px] font-medium text-muted-foreground hover:text-foreground">
            Notes for each format
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(["social", "article", "script", "ad"] as const).map((f) => (
              <Field
                key={f}
                label={
                  f === "social"
                    ? "Posts"
                    : f === "script"
                      ? "Video scripts"
                      : f === "ad"
                        ? "Ads"
                        : "Articles"
                }
              >
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
                  placeholder={
                    f === "article"
                      ? "Use a heading every 250 words"
                      : f === "ad"
                        ? "Lead with the result"
                        : "Keep it under 3 lines"
                  }
                  className="ds-well w-full resize-none px-3.5 py-2.5 text-[13px] outline-none placeholder:text-muted-foreground/70"
                />
              </Field>
            ))}
          </div>
        </details>
      </Tile>
    </div>
  );
}

// ── Look ────────────────────────────────────────────────────────────────────

const ROLES = [
  ["primary", "Main"],
  ["secondary", "Second"],
  ["accent", "Accent"],
  ["background", "Background"],
  ["text", "Text"],
] as const;

function LookTab({
  v,
  inheritColors,
  inheritFonts,
  inheritLogo,
  resolvedPalette,
  resolvedFonts,
  assets,
  set,
  setInherit,
  disabled,
}: {
  v: VisualStyle;
  inheritColors: boolean;
  inheritFonts: boolean;
  inheritLogo: boolean;
  resolvedPalette: NonNullable<VisualStyle["palette"]>;
  resolvedFonts: NonNullable<VisualStyle["typography"]>;
  assets: KitAssetView[];
  set: (key: keyof VisualStyle, value: unknown) => void;
  setInherit: (key: "colors" | "fonts" | "logo", on: boolean) => void;
  disabled: boolean;
}) {
  const palette = v.palette ?? {};
  const t = v.typography ?? {};
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
      <Tile className="space-y-4">
        <Field
          label="Colors"
          hint={inheritColors ? "Empty ones use your Brand DNA colors" : "Only these colors"}
          aside={
            <LinkedToggle
              on={inheritColors}
              onChange={(on) => setInherit("colors", on)}
              disabled={disabled}
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map(([role, label]) => (
              <ColorField
                key={role}
                label={
                  palette[role] ? label : resolvedPalette[role] ? `${label} (Brand DNA)` : label
                }
                value={palette[role] ?? resolvedPalette[role]}
                disabled={disabled}
                onChange={(hex) => set("palette", { ...palette, [role]: hex })}
                onClear={
                  palette[role]
                    ? () => set("palette", { ...palette, [role]: undefined })
                    : undefined
                }
              />
            ))}
          </div>
        </Field>
      </Tile>

      <Tile className="space-y-5">
        <Field
          label="Fonts"
          hint="Used on images, carousels and video captions"
          aside={
            <LinkedToggle
              on={inheritFonts}
              onChange={(on) => setInherit("fonts", on)}
              disabled={disabled}
            />
          }
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <div className="text-[12px] text-muted-foreground">Headlines</div>
              <FontPicker
                value={t.heading ?? resolvedFonts.heading}
                uploaded={uploadedFonts}
                disabled={disabled}
                sampleText="Big bold headline"
                onChange={(fam, id) => setFont("heading", fam, id)}
              />
            </div>
            <div className="space-y-1.5">
              <div className="text-[12px] text-muted-foreground">Body text</div>
              <FontPicker
                value={t.body ?? resolvedFonts.body}
                uploaded={uploadedFonts}
                disabled={disabled}
                sampleText="Easy to read at any size"
                onChange={(fam, id) => setFont("body", fam, id)}
              />
            </div>
          </div>
        </Field>
        <div className="grid gap-5 sm:grid-cols-2">
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
      </Tile>

      <Tile className="space-y-5">
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
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ["mood", "Mood", "Warm, calm, optimistic"],
              ["lighting", "Light", "Soft daylight from the side"],
              ["grading", "Color feel", "Muted, slightly warm film look"],
              ["texture", "Texture", "Clean, a little paper grain"],
            ] as const
          ).map(([key, label, ph]) => (
            <Field key={key} label={label}>
              <input
                value={(v[key] as string | undefined) ?? ""}
                disabled={disabled}
                onChange={(e) => set(key, e.target.value.slice(0, 160))}
                placeholder={ph}
                className="ds-well h-10 w-full px-4 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
              />
            </Field>
          ))}
        </div>
        <Field label="Layout">
          <textarea
            value={v.composition ?? ""}
            disabled={disabled}
            onChange={(e) => set("composition", e.target.value.slice(0, 300))}
            placeholder="Subject off-center on the left, lots of empty space, headline in a band at the bottom"
            rows={2}
            className="ds-well w-full resize-none px-4 py-3 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
          />
        </Field>
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
      </Tile>

      <Tile className="space-y-4">
        <Field
          label="Logo on images"
          aside={
            <div className="flex items-center gap-2">
              <LinkedToggle
                on={inheritLogo}
                onChange={(on) => setInherit("logo", on)}
                disabled={disabled}
              />
              <Switch
                checked={v.logo?.use !== false}
                disabled={disabled}
                onCheckedChange={(on) => set("logo", { ...(v.logo ?? {}), use: on })}
                aria-label="Show logo"
              />
            </div>
          }
        >
          {v.logo?.use !== false && (
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Segmented
                value={v.logo?.variant}
                disabled={disabled || !logos.length}
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
            </div>
          )}
          {!logos.length && (
            <p className="text-[12px] text-muted-foreground">
              Upload logos under Logos to pick one here.
            </p>
          )}
        </Field>
      </Tile>
    </div>
  );
}

// ── Video ───────────────────────────────────────────────────────────────────

function VideoTab({
  vid,
  set,
  disabled,
}: {
  vid: VideoStyle;
  set: (key: keyof VideoStyle, value: unknown) => void;
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
              className="ds-well h-10 w-full px-4 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
            />
          </Field>
        ))}
      </Tile>
      <Tile className="space-y-5">
        <Field
          label="Captions on video"
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
            <div className="space-y-4">
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
                  disabled={disabled}
                  onChange={(h) => set("captions", { ...cap, color: h })}
                  onClear={() => set("captions", { ...cap, color: undefined })}
                />
                <ColorField
                  label="Highlight"
                  value={cap.highlight}
                  disabled={disabled}
                  onChange={(h) => set("captions", { ...cap, highlight: h })}
                  onClear={() => set("captions", { ...cap, highlight: undefined })}
                />
              </div>
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
            </div>
          )}
        </Field>
      </Tile>
    </div>
  );
}

// ── Examples attached to this style ─────────────────────────────────────────

function ExamplesTab({
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
  const refs = spec.references ?? [];
  const byId = new Map(assets.map((a) => [a.id, a]));
  const attached = refs
    .map((r) => ({ ref: r, asset: byId.get(r.assetId) }))
    .filter((x) => x.asset) as Array<{
    ref: (typeof refs)[number];
    asset: KitAssetView;
  }>;
  const writing = assets.filter((a) => a.kind === "writing_sample" && a.styleId === style.id);
  const library = assets.filter(
    (a) =>
      (a.kind === "inspiration_image" || a.kind === "inspiration_video") &&
      !refs.some((r) => r.assetId === a.id),
  );
  const learnIds = [...attached.map((x) => x.asset.id), ...writing.map((w) => w.id)];
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

  const relearn = () =>
    suggest.mutate(learnIds, {
      onSuccess: (s) => {
        if (s.pending) {
          toastLater("Still reading some examples. Try again in a moment.");
          return;
        }
        onSpec(applySuggestion(spec, s.spec));
      },
    });

  return (
    <div className="space-y-4">
      <Tile>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[13.5px] font-medium">Example posts and videos</div>
            <div className="text-[12px] text-muted-foreground">
              Sent with every picture this style makes. "Exact" makes new images look like the next
              post in the series.
            </div>
          </div>
          {!disabled && learnIds.length > 0 && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
              onClick={relearn}
              disabled={suggest.isPending}
            >
              {suggest.isPending ? (
                <Spinner className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Learn again
            </button>
          )}
        </div>
        {attached.length > 0 && (
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {attached.map(({ ref, asset }) => (
              <div key={asset.id} className="group relative">
                <ExampleThumb asset={asset} />
                <div className="mt-2 flex items-center justify-between gap-1">
                  <Segmented
                    size="sm"
                    value={ref.strength}
                    disabled={disabled}
                    onChange={(s) =>
                      setRefs(
                        refs.map((r) =>
                          r.assetId === asset.id ? { ...r, strength: s ?? "close" } : r,
                        ),
                      )
                    }
                    options={[
                      { value: "loose", label: "Loose" },
                      { value: "close", label: "Close" },
                      { value: "exact", label: "Exact" },
                    ]}
                  />
                  {!disabled && (
                    <button
                      type="button"
                      className={dsIconBtn}
                      aria-label="Detach example"
                      onClick={() => setRefs(refs.filter((r) => r.assetId !== asset.id))}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {!disabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DropZone
              compact
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              onFiles={onUpload}
              busy={upload.isPending}
              icon={ImagePlus}
              title="Upload examples"
              hint="Posts, ads or short videos you want to look like"
            />
            <button
              type="button"
              disabled={!library.length}
              onClick={() => setPicking((v) => !v)}
              className="ds-well flex min-h-[120px] flex-col items-center justify-center gap-2 p-4 text-center transition-colors hover:bg-[var(--ds-well-bg-hover)] disabled:opacity-50"
            >
              <Plus className="h-5 w-5 text-primary" />
              <span className="text-[13.5px] font-medium">Pick from your kit</span>
              <span className="text-[12px] text-muted-foreground">
                {library.length
                  ? `${library.length} examples not used here`
                  : "Nothing else in your kit yet"}
              </span>
            </button>
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
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4">
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

      <Tile>
        <div className="mb-3 text-[13.5px] font-medium">Writing samples for this style</div>
        {writing.length ? (
          <ul className="space-y-2">
            {writing.map((w) => (
              <li key={w.id} className="ds-well flex items-start gap-3 p-3">
                <AnalysisDot asset={w} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-[12.5px] text-foreground/85">
                    {w.textContent}
                  </div>
                  {w.analysis?.summary && (
                    <div className="mt-1 text-[11.5px] text-muted-foreground">
                      {w.analysis.summary}
                    </div>
                  )}
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
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            Add samples under Writing, or when you create a style.
          </p>
        )}
      </Tile>
    </div>
  );
}

function toastLater(msg: string) {
  void import("sonner").then(({ toast }) => toast(msg));
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

// ── Use for ─────────────────────────────────────────────────────────────────

function UseTab({
  draft,
  style,
  disabled,
  onChange,
  onArchive,
  onDuplicate,
  onToDna,
}: {
  draft: Draft;
  style: BrandStyleView;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onArchive: () => void;
  onDuplicate: () => void;
  onToDna: () => void;
}) {
  const all = draft.appliesTo.length === 0;
  const toggle = (f: StyleFormat) => {
    const has = draft.appliesTo.includes(f);
    onChange({ appliesTo: has ? draft.appliesTo.filter((x) => x !== f) : [...draft.appliesTo, f] });
  };
  return (
    <div className="space-y-4">
      <Tile className="space-y-4">
        <Field
          label="Use this style for"
          hint={
            style.isDefault
              ? "As the default, it's used for these unless you pick another style."
              : "When you pick it, it's used for anything. As a default, only for these."
          }
        >
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange({ appliesTo: [] })}
              className={cn(
                "h-9 rounded-full px-4 text-[13px] font-medium transition-all",
                all
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "ds-well text-muted-foreground hover:text-foreground",
              )}
            >
              Everything
            </button>
            {STYLE_FORMATS.map((f) => {
              const on = draft.appliesTo.includes(f);
              return (
                <button
                  key={f}
                  type="button"
                  disabled={disabled}
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
        </Field>
        <Field label="Note for your team">
          <textarea
            value={draft.description}
            disabled={disabled}
            onChange={(e) => onChange({ description: e.target.value.slice(0, 400) })}
            placeholder="For launches and big announcements"
            rows={2}
            className="ds-well w-full resize-none px-4 py-3 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
          />
        </Field>
      </Tile>
      {!disabled && (
        <Tile className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            onClick={onToDna}
          >
            <Brain className="h-4 w-4" /> Copy colors and fonts to Brand DNA
          </button>
          <button
            type="button"
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            onClick={onDuplicate}
          >
            <Sparkles className="h-4 w-4" /> Duplicate
          </button>
          <button
            type="button"
            className={cn(
              dsGhostBtn,
              "h-9 px-4 text-[13px] text-destructive hover:text-destructive",
            )}
            onClick={onArchive}
          >
            <Trash className="h-4 w-4" /> Archive
          </button>
        </Tile>
      )}
      <GroupLabel>Where it's used</GroupLabel>
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Studio posts, carousels, articles, scripts, ads, images and videos, UGC videos, chat drafts
        and calendar images. Brand DNA still supplies the facts.
      </p>
    </div>
  );
}

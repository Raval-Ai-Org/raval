"use client";
// CreateStyleFlow — make a new Style in a few steps:
//
//   start → (examples → learning | describe) → finish
//
// Examples are uploaded and studied as soon as they're added, so by the time
// someone presses Continue most of the work is done. Finish shows the style
// with its colours, fonts and mood ready to change, and a name to save it under.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  ChevronDown,
  FileText,
  ImagePlus,
  Link,
  PenLine,
  Sparkles,
  Spinner,
  Wand,
} from "@/components/icons";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import type { BrandKitOverview, KitAssetView } from "@/lib/brand-kit/contracts";
import { applySuggestion, markUserEdited, type Suggestion } from "@/lib/brand-kit/merge";
import {
  STYLE_FORMATS,
  STYLE_FORMAT_LABELS,
  emptySpec,
  type StyleFormat,
  type StyleSpec,
  type VisualStyle,
} from "@/lib/brand-kit/spec";
import {
  useAddWritingSample,
  useCreateStyle,
  useDescribeStyle,
  useSuggestStyle,
  useUploadKitFiles,
} from "./hooks";
import { PaletteEditor } from "./ColorPicker";
import { DropZone, Field, FontPicker, Segmented } from "./controls";
import { MatchControl, MoodChips, swatchGroups } from "./look";
import { ExampleThumb } from "./StyleEditor";
import { PostPreview, resolveView, useStyleFonts } from "./preview";

type Step = "start" | "examples" | "learning" | "describe" | "finish";

const MEDIA_ACCEPT = "image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime";

const DESCRIBE_IDEAS = [
  "Clean and minimal, lots of white space, calm and expert",
  "Bold colors, big type, playful and a bit cheeky",
  "Warm lifestyle photos, soft light, friendly and personal",
  "Dark and premium, gold details, confident and short",
];

export function CreateStyleFlow({
  workspaceId,
  data,
  preselected,
  onCancel,
  onCreated,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  preselected?: string[];
  onCancel: () => void;
  onCreated: (styleId: string) => void;
}) {
  const [step, setStep] = React.useState<Step>(preselected?.length ? "learning" : "start");
  const [assetIds, setAssetIds] = React.useState<string[]>(preselected ?? []);
  const [spec, setSpec] = React.useState<StyleSpec>(emptySpec());
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [name, setName] = React.useState("");
  const [appliesTo, setAppliesTo] = React.useState<StyleFormat[]>([]);
  const [makeDefault, setMakeDefault] = React.useState(
    !data.styles.some((s) => s.isDefault && !s.archived),
  );
  const create = useCreateStyle(workspaceId);

  const back = () => {
    if (step === "examples" || step === "describe") setStep("start");
    else if (step === "learning") setStep("examples");
    else if (step === "finish")
      setStep(assetIds.length ? "examples" : suggestion ? "describe" : "start");
    else onCancel();
  };

  const finish = () =>
    create.mutate(
      {
        name: name.trim() || "My style",
        appliesTo,
        spec,
        makeDefault,
      },
      { onSuccess: (view) => onCreated(view.id) },
    );

  return (
    <SurfacePage width="wide" className="pt-4">
      <div className="mb-6 flex items-center gap-3">
        <button type="button" className={dsIconBtn} aria-label="Back" onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h3 className="ds-page-title">New style</h3>
        <StepDots step={step} />
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          {step === "start" && (
            <StartStep
              hasDna={data.dna.hasDna}
              onPick={(how) => {
                if (how === "examples") setStep("examples");
                else if (how === "describe") setStep("describe");
                else {
                  const s = emptySpec();
                  if (how === "blank")
                    s.inherit = {
                      colors: false,
                      fonts: false,
                      voice: false,
                      logo: true,
                      rules: true,
                    };
                  setSpec(s);
                  setSuggestion(null);
                  setName(how === "dna" ? `${data.dna.brandName ?? "Brand"} default` : "");
                  setStep("finish");
                }
              }}
            />
          )}
          {step === "examples" && (
            <ExamplesStep
              workspaceId={workspaceId}
              data={data}
              assetIds={assetIds}
              onChange={setAssetIds}
              onNext={() => setStep("learning")}
            />
          )}
          {step === "learning" && (
            <LearningStep
              workspaceId={workspaceId}
              data={data}
              assetIds={assetIds}
              onDone={(s) => {
                setSuggestion(s);
                setSpec(applySuggestion(emptySpec(), s.spec));
                setStep("finish");
              }}
            />
          )}
          {step === "describe" && (
            <DescribeStep
              workspaceId={workspaceId}
              onDone={(result) => {
                setSuggestion({ spec: result.spec, confidence: {}, sources: 0 });
                setSpec(applySuggestion(emptySpec(), result.spec));
                setName(result.name);
                setStep("finish");
              }}
            />
          )}
          {step === "finish" && (
            <FinishStep
              data={data}
              suggestion={suggestion}
              spec={spec}
              onSpec={setSpec}
              name={name}
              onName={setName}
              appliesTo={appliesTo}
              onAppliesTo={setAppliesTo}
              makeDefault={makeDefault}
              onMakeDefault={setMakeDefault}
              busy={create.isPending}
              onCreate={finish}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </SurfacePage>
  );
}

const STEP_ORDER: Step[] = ["start", "examples", "learning", "finish"];
function StepDots({ step }: { step: Step }) {
  const idx = step === "describe" ? 1 : STEP_ORDER.indexOf(step);
  return (
    <div className="ml-auto flex items-center gap-1.5" aria-hidden>
      {STEP_ORDER.map((s, i) => (
        <span
          key={s}
          className={cn(
            "h-1.5 rounded-full transition-all duration-300",
            i === idx
              ? "w-6 bg-primary"
              : i < idx
                ? "w-1.5 bg-primary/60"
                : "w-1.5 bg-[var(--ds-well-bg-hover)]",
          )}
        />
      ))}
    </div>
  );
}

// ── Start ───────────────────────────────────────────────────────────────────

function StartStep({
  hasDna,
  onPick,
}: {
  hasDna: boolean;
  onPick: (how: "examples" | "describe" | "dna" | "blank") => void;
}) {
  const options = [
    {
      id: "examples" as const,
      icon: ImagePlus,
      title: "From examples",
      body: "Upload posts you like. Mellox copies the look.",
      best: true,
    },
    {
      id: "describe" as const,
      icon: PenLine,
      title: "Describe it",
      body: "Say the look in a sentence.",
    },
    ...(hasDna
      ? [
          {
            id: "dna" as const,
            icon: Brain,
            title: "From Brand DNA",
            body: "Use your saved colors and fonts.",
          },
        ]
      : []),
    {
      id: "blank" as const,
      icon: Sparkles,
      title: "Start blank",
      body: "Set it up yourself.",
    },
  ];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {options.map((o, i) => (
        <motion.button
          key={o.id}
          type="button"
          onClick={() => onPick(o.id)}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className={cn(
            "ds-tile ds-tile-hover group relative flex min-h-[150px] flex-col items-start gap-3 p-5 text-left",
            o.best && "ds-glow ring-1 ring-primary/25",
          )}
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/12 text-primary transition-transform duration-300 group-hover:scale-110">
            <o.icon className="h-5 w-5" />
          </span>
          <div>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              {o.title}
              {o.best && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[10.5px] font-semibold text-primary-foreground">
                  Best
                </span>
              )}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{o.body}</p>
          </div>
          <ArrowRight className="absolute right-5 top-5 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </motion.button>
      ))}
    </div>
  );
}

// ── Examples ────────────────────────────────────────────────────────────────

function ExamplesStep({
  workspaceId,
  data,
  assetIds,
  onChange,
  onNext,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  assetIds: string[];
  onChange: (ids: string[]) => void;
  onNext: () => void;
}) {
  const upload = useUploadKitFiles(workspaceId);
  const addSample = useAddWritingSample(workspaceId);
  const [text, setText] = React.useState("");
  const [mode, setMode] = React.useState<"text" | "link">("text");
  const chosen = new Set(assetIds);
  const byId = new Map(data.assets.map((a) => [a.id, a]));
  const picked = assetIds.map((id) => byId.get(id)).filter(Boolean) as KitAssetView[];
  const library = data.assets.filter(
    (a) =>
      (a.kind === "inspiration_image" ||
        a.kind === "inspiration_video" ||
        a.kind === "writing_sample") &&
      !chosen.has(a.id),
  );

  const onFiles = async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    const ids: string[] = [];
    if (images.length)
      ids.push(...(await upload.mutateAsync({ kind: "inspiration_image", files: images })).ids);
    if (videos.length)
      ids.push(...(await upload.mutateAsync({ kind: "inspiration_video", files: videos })).ids);
    onChange([...assetIds, ...ids]);
  };

  const addText = () => {
    const value = text.trim();
    if (!value) return;
    addSample.mutate(mode === "text" ? { text: value } : { url: value }, {
      onSuccess: (r) => {
        onChange([...assetIds, r.assetId]);
        setText("");
      },
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="space-y-4">
        <DropZone
          accept={MEDIA_ACCEPT}
          onFiles={onFiles}
          busy={upload.isPending}
          icon={ImagePlus}
          title="Add posts or videos"
          hint="3 to 8 that look alike work best"
        />
        <Tile className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[13.5px] font-medium">
              <FileText className="h-4 w-4 text-primary" /> Writing (optional)
            </div>
            <Segmented
              size="sm"
              value={mode}
              onChange={(v) => v && setMode(v)}
              options={[
                { value: "text", label: "Text" },
                { value: "link", label: "Link" },
              ]}
            />
          </div>
          {mode === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={4}
              placeholder="Paste captions or posts in the voice you want"
              className="ds-well w-full resize-none px-4 py-3 text-[13.5px] outline-none placeholder:text-muted-foreground/70"
            />
          ) : (
            <div className="ds-well flex items-center gap-2 px-4">
              <Link className="h-4 w-4 text-muted-foreground" />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="https://…"
                className="h-11 flex-1 bg-transparent text-[13.5px] outline-none"
              />
            </div>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
              disabled={
                addSample.isPending || (mode === "text" ? text.trim().length < 40 : !text.trim())
              }
              onClick={addText}
            >
              {addSample.isPending ? <Spinner className="h-3.5 w-3.5 animate-spin" /> : null} Add
            </button>
          </div>
        </Tile>
        {library.length > 0 && (
          <Tile>
            <div className="mb-3 text-[13px] font-medium text-muted-foreground">From your kit</div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
              {library.slice(0, 18).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onChange([...assetIds, a.id])}
                  className="rounded-[14px] transition-transform hover:scale-[1.04]"
                  title={a.label ?? undefined}
                >
                  {a.kind === "writing_sample" ? (
                    <div className="ds-well grid aspect-square place-items-center p-1.5 text-[10px] leading-tight text-muted-foreground">
                      <span className="line-clamp-4">{a.textContent}</span>
                    </div>
                  ) : (
                    <ExampleThumb asset={a} />
                  )}
                </button>
              ))}
            </div>
          </Tile>
        )}
      </div>
      <Tile className="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <div className="ds-label">Added ({picked.length})</div>
        {picked.length ? (
          <div className="grid grid-cols-3 gap-2">
            {picked.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => onChange(assetIds.filter((x) => x !== a.id))}
                title="Remove"
                className="group relative"
              >
                {a.kind === "writing_sample" ? (
                  <div className="ds-well grid aspect-square place-items-center p-1.5 text-[10px] leading-tight text-muted-foreground">
                    <span className="line-clamp-4">{a.textContent}</span>
                  </div>
                ) : (
                  <ExampleThumb asset={a} />
                )}
                <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/40 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                  Remove
                </span>
              </button>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          className={cn(dsPrimaryBtn, "h-10 text-[13px]")}
          disabled={!picked.length || upload.isPending}
          onClick={onNext}
        >
          Continue <ArrowRight className="h-4 w-4" />
        </button>
      </Tile>
    </div>
  );
}

// ── Learning ────────────────────────────────────────────────────────────────

const LEARNING_LINES = [
  "Picking out the colors",
  "Reading the fonts and layout",
  "Looking at light and mood",
  "Listening to the writing voice",
  "Putting it all together",
];

function LearningStep({
  workspaceId,
  data,
  assetIds,
  onDone,
}: {
  workspaceId: string;
  data: BrandKitOverview;
  assetIds: string[];
  onDone: (s: Suggestion) => void;
}) {
  const suggest = useSuggestStyle(workspaceId);
  const byId = new Map(data.assets.map((a) => [a.id, a]));
  const items = assetIds.map((id) => byId.get(id)).filter(Boolean) as KitAssetView[];
  const busy = items.filter(
    (a) => (a.analysisStatus === "pending" || a.analysisStatus === "running") && !a.stale,
  );
  const done = items.filter((a) => a.analysisStatus === "done");
  const [line, setLine] = React.useState(0);
  const started = React.useRef(false);

  React.useEffect(() => {
    const t = setInterval(() => setLine((n) => (n + 1) % LEARNING_LINES.length), 1800);
    return () => clearInterval(t);
  }, []);

  React.useEffect(() => {
    if (busy.length || started.current || !items.length) return;
    started.current = true;
    suggest.mutate(assetIds, { onSuccess: onDone });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy.length, items.length]);

  const progress = items.length
    ? Math.round(((items.length - busy.length) / items.length) * 100)
    : 0;
  return (
    <div className="mx-auto max-w-[720px] text-center">
      <div className="relative mx-auto mb-6 grid h-20 w-20 place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full bg-primary/15"
          animate={{ scale: [1, 1.25, 1], opacity: [0.7, 0.2, 0.7] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        />
        <span className="relative grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.8)]">
          <Sparkles className="h-6 w-6" />
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={suggest.isPending ? "merge" : line}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="text-[16px] font-medium"
        >
          {suggest.isPending ? "Putting it all together" : LEARNING_LINES[line]}
        </motion.div>
      </AnimatePresence>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {done.length} of {items.length} studied
      </p>
      <div className="mx-auto mt-4 h-1.5 max-w-[320px] overflow-hidden rounded-full bg-[var(--ds-well-bg-hover)]">
        <motion.div
          className="h-full rounded-full bg-primary"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
      <div className="mt-8 grid grid-cols-3 gap-3 sm:grid-cols-4">
        {items.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
          >
            {a.kind === "writing_sample" ? (
              <div
                className={cn(
                  "ds-well relative grid aspect-square place-items-center overflow-hidden p-2 text-[10.5px] leading-tight text-muted-foreground",
                  busy.includes(a) && "ds-scan",
                )}
              >
                <span className="line-clamp-5">{a.textContent}</span>
                {a.analysisStatus === "done" && (
                  <span className="absolute bottom-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            ) : (
              <ExampleThumb asset={a} />
            )}
          </motion.div>
        ))}
      </div>
      {busy.length > 0 && done.length > 0 && (
        <button
          type="button"
          className={cn(dsGhostBtn, "mt-6 h-9 px-4 text-[13px]")}
          onClick={() => {
            started.current = true;
            suggest.mutate(
              done.map((a) => a.id),
              { onSuccess: onDone },
            );
          }}
        >
          Continue with {done.length} ready
        </button>
      )}
      {!busy.length && !done.length && items.length > 0 && !suggest.isPending && (
        <p className="mt-6 text-[13px] text-destructive">
          Couldn't read these. Try other examples.
        </p>
      )}
    </div>
  );
}

// ── Describe ────────────────────────────────────────────────────────────────

function DescribeStep({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: (r: { name: string; spec: StyleSpec }) => void;
}) {
  const describe = useDescribeStyle(workspaceId);
  const [text, setText] = React.useState("");
  return (
    <div className="mx-auto max-w-[680px]">
      <Tile className="ds-glow space-y-4 p-5 sm:p-6">
        <div className="text-[15px] font-semibold">Describe the look and voice</div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 2000))}
          rows={5}
          placeholder="Bright and friendly, flat illustrations, lots of color, short punchy captions with a few emoji"
          className="ds-well w-full resize-none px-4 py-3 text-[14px] leading-relaxed outline-none placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/30"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim().length >= 8)
              describe.mutate(text, { onSuccess: onDone });
          }}
        />
        <div className="flex flex-wrap gap-2">
          {DESCRIBE_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              onClick={() => setText(idea)}
              className="ds-well rounded-full px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground"
            >
              {idea}
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-10 px-5 text-[13px]")}
            disabled={text.trim().length < 8 || describe.isPending}
            onClick={() => describe.mutate(text, { onSuccess: onDone })}
          >
            {describe.isPending ? (
              <Spinner className="h-4 w-4 animate-spin" />
            ) : (
              <Wand className="h-4 w-4" />
            )}
            {describe.isPending ? "Creating" : "Create style"}
          </button>
        </div>
      </Tile>
    </div>
  );
}

// ── Finish ──────────────────────────────────────────────────────────────────

/** Learned details that have no control of their own on this screen. */
const DETAIL_LABELS: Record<string, string> = {
  "visual.medium": "Kind of image",
  "visual.lighting": "Light",
  "visual.grading": "Color feel",
  "visual.texture": "Texture",
  "visual.composition": "Layout",
  "visual.background": "Background",
  "visual.whitespace": "Space",
  "visual.elements": "Shapes and details",
  "visual.textOnImage": "Words on images",
  "visual.logo": "Logo corner",
  "visual.avoid": "Never do",
  "writing.voice": "Voice",
  "writing.tone": "Tone",
  "writing.sentenceLength": "Sentences",
  "writing.person": "Speaks as",
  "writing.emoji": "Emoji",
  "writing.hashtags": "Hashtags",
  "writing.hooks": "How posts open",
  "writing.cta": "Call to action",
  "writing.signaturePhrases": "Phrases",
  "video.pacing": "Pace",
  "video.shots": "Shots",
  "video.transitions": "Cuts",
  "video.hook": "First seconds",
  "video.captions": "Captions",
  "video.music": "Music",
};

function summarize(path: string, value: unknown): string {
  if (value == null) return "";
  if (path === "writing.tone") {
    const t = value as Record<string, number | undefined>;
    const word = (v: number | undefined, low: string, high: string) =>
      v == null ? "" : v >= 60 ? high : v <= 40 ? low : "";
    return (
      [
        word(t.casual, "formal", "casual"),
        word(t.playful, "serious", "playful"),
        word(t.detailed, "short", "detailed"),
        word(t.bold, "quiet", "bold"),
      ]
        .filter(Boolean)
        .join(", ") || "balanced"
    );
  }
  if (path === "writing.hashtags") {
    const h = value as { count?: number; always?: string[] };
    return [
      h.count != null ? `about ${h.count}` : "",
      h.always?.length ? h.always.map((x) => `#${x}`).join(" ") : "",
    ]
      .filter(Boolean)
      .join(", ");
  }
  if (path === "visual.textOnImage") {
    const t = value as { maxWords?: number; style?: string };
    return [t.maxWords != null ? `up to ${t.maxWords} words` : "", t.style ?? ""]
      .filter(Boolean)
      .join(", ");
  }
  if (path === "visual.logo")
    return (value as { corner?: string }).corner?.replace("-", " ") ?? "on";
  if (path === "video.captions") {
    const c = value as { style?: string; position?: string };
    return c.style ?? c.position ?? "on";
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return "";
  return String(value);
}

export function FinishStep({
  data,
  suggestion,
  spec,
  onSpec,
  name,
  onName,
  appliesTo,
  onAppliesTo,
  makeDefault,
  onMakeDefault,
  busy,
  onCreate,
}: {
  data: BrandKitOverview;
  suggestion: Suggestion | null;
  spec: StyleSpec;
  onSpec: (s: StyleSpec) => void;
  name: string;
  onName: (v: string) => void;
  appliesTo: StyleFormat[];
  onAppliesTo: (v: StyleFormat[]) => void;
  makeDefault: boolean;
  onMakeDefault: (v: boolean) => void;
  busy: boolean;
  onCreate: () => void;
}) {
  const resolved = React.useMemo(
    () =>
      resolveView(
        {
          id: "draft",
          name: name || "New style",
          version: 1,
          spec,
          appliesTo,
          description: null,
          isDefault: false,
          status: "draft",
          coverUrl: null,
          createdAt: "",
          updatedAt: "",
          archived: false,
        },
        data.dna,
      ),
    [spec, name, appliesTo, data.dna],
  );
  useStyleFonts(resolved, data.assets);
  const logo = data.assets.find((a) => a.kind === "logo")?.url ?? data.dna.logoUrl;
  const visual = spec.visual ?? {};
  const type = visual.typography ?? {};
  const refs = spec.references ?? [];
  const groups = React.useMemo(() => swatchGroups(data, spec), [data, spec]);
  const byId = new Map(data.assets.map((a) => [a.id, a]));
  const examples = refs.map((r) => byId.get(r.assetId)).filter(Boolean) as KitAssetView[];
  const uploadedFonts = data.assets
    .filter((a) => a.kind === "font_file")
    .map((a) => ({ id: a.id, family: a.label ?? "Custom font" }));

  /** Set one look field and mark it as the person's own. */
  const setVisual = <K extends keyof VisualStyle>(key: K, value: VisualStyle[K] | undefined) => {
    const next = { ...visual };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onSpec(markUserEdited({ ...spec, visual: next }, [`visual.${key}`]));
  };
  const setFont = (role: "heading" | "body", family: string | undefined, fileId?: string) => {
    const files = { ...(type.files ?? {}) };
    if (fileId) files[role] = fileId;
    else delete files[role];
    setVisual("typography", {
      ...type,
      [role]: family,
      files: Object.keys(files).length ? files : undefined,
    });
  };

  const details = React.useMemo(() => {
    const out: string[] = [];
    for (const section of ["visual", "writing", "video"] as const) {
      for (const key of Object.keys(suggestion?.spec[section] ?? {}))
        if (DETAIL_LABELS[`${section}.${key}`]) out.push(`${section}.${key}`);
    }
    return out;
  }, [suggestion]);
  const has = (path: string) => {
    const [section, key] = path.split(".") as ["visual" | "writing" | "video", string];
    return (spec[section] as Record<string, unknown> | undefined)?.[key] !== undefined;
  };
  const toggleDetail = (path: string) => {
    const [section, key] = path.split(".") as ["visual" | "writing" | "video", string];
    const next = { ...((spec[section] ?? {}) as Record<string, unknown>) };
    if (has(path)) delete next[key];
    else next[key] = (suggestion?.spec[section] as Record<string, unknown>)[key];
    onSpec({ ...spec, [section]: next });
  };
  const toggleFormat = (f: StyleFormat) =>
    onAppliesTo(appliesTo.includes(f) ? appliesTo.filter((x) => x !== f) : [...appliesTo, f]);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Tile className="space-y-6 p-5 sm:p-6">
        <input
          autoFocus
          value={name}
          aria-label="Style name"
          onChange={(e) => onName(e.target.value.slice(0, 80))}
          placeholder="Name your style"
          className="ds-well h-12 w-full px-4 text-[15px] font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-primary/30"
          onKeyDown={(e) => e.key === "Enter" && !busy && onCreate()}
        />

        <Field label="Colors">
          <PaletteEditor
            palette={visual.palette ?? {}}
            fallback={resolved.visual.palette}
            groups={groups}
            onChange={(palette) => setVisual("palette", palette)}
          />
        </Field>

        <Field label="Fonts">
          <div className="grid gap-3 sm:grid-cols-2">
            <FontPicker
              value={type.heading ?? resolved.visual.typography?.heading}
              uploaded={uploadedFonts}
              placeholder="Headline font"
              sampleText="Big bold headline"
              onChange={(family, id) => setFont("heading", family, id)}
            />
            <FontPicker
              value={type.body ?? resolved.visual.typography?.body}
              uploaded={uploadedFonts}
              placeholder="Text font"
              sampleText="Easy to read at any size"
              onChange={(family, id) => setFont("body", family, id)}
            />
          </div>
        </Field>

        {refs.length > 0 && (
          <Field label="Copy my examples">
            <MatchControl
              references={refs}
              onChange={(references) => onSpec({ ...spec, references })}
            />
          </Field>
        )}

        <Field label="Mood">
          <MoodChips value={visual.mood} onChange={(mood) => setVisual("mood", mood)} />
        </Field>

        <details className="group">
          <summary className="flex cursor-pointer select-none list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" /> More
          </summary>
          <div className="mt-4 space-y-5">
            <Field label="Text on images">
              <Segmented
                value={visual.textPlacement}
                onChange={(p) => setVisual("textPlacement", p)}
                options={[
                  { value: "top", label: "Top" },
                  { value: "center", label: "Middle" },
                  { value: "bottom", label: "Bottom" },
                  { value: "none", label: "No text" },
                ]}
              />
            </Field>
            <Field label="Use it for">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onAppliesTo([])}
                  className={cn(
                    "h-9 rounded-full px-4 text-[13px] font-medium transition-all",
                    !appliesTo.length
                      ? "bg-primary text-primary-foreground"
                      : "ds-well text-muted-foreground",
                  )}
                >
                  Everything
                </button>
                {STYLE_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleFormat(f)}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13px] font-medium transition-all",
                      appliesTo.includes(f)
                        ? "bg-primary/15 ring-1 ring-primary/40"
                        : "ds-well text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {appliesTo.includes(f) && <Check className="h-3.5 w-3.5 text-primary" />}
                    {STYLE_FORMAT_LABELS[f]}
                  </button>
                ))}
              </div>
            </Field>
            {details.length > 0 && (
              <Field label="What Mellox learned">
                <ul className="-mx-2">
                  {details.map((path) => {
                    const [section, key] = path.split(".") as [
                      "visual" | "writing" | "video",
                      string,
                    ];
                    const on = has(path);
                    return (
                      <li key={path}>
                        <button
                          type="button"
                          aria-pressed={on}
                          onClick={() => toggleDetail(path)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-[var(--ds-well-bg)]",
                            !on && "opacity-50",
                          )}
                        >
                          <span
                            className={cn(
                              "grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1 transition-colors",
                              on
                                ? "bg-primary text-primary-foreground ring-primary"
                                : "ring-[var(--ds-tile-border)]",
                            )}
                          >
                            {on && <Check className="h-3 w-3" />}
                          </span>
                          <span className="w-[120px] shrink-0 text-[12.5px] text-muted-foreground">
                            {DETAIL_LABELS[path]}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            {summarize(
                              path,
                              (suggestion?.spec[section] as Record<string, unknown>)[key],
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Field>
            )}
          </div>
        </details>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ds-tile-border)] pt-5">
          <label className="inline-flex cursor-pointer items-center gap-2.5 text-[13.5px]">
            <Switch checked={makeDefault} onCheckedChange={onMakeDefault} />
            Use by default
          </label>
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-11 px-6 text-[14px]")}
            disabled={busy}
            onClick={onCreate}
          >
            {busy ? <Spinner className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Save style
          </button>
        </div>
      </Tile>

      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <Tile className="p-3 sm:p-3">
          <PostPreview resolved={resolved} brandName={data.dna.brandName} logoUrl={logo} />
        </Tile>
        {examples.length > 0 && (
          <div className="grid grid-cols-4 gap-2">
            {examples.slice(0, 8).map((a) => (
              <ExampleThumb key={a.id} asset={a} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

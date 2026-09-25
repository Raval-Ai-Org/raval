"use client";
// The Brand Kit library: logos, colours, fonts, elements, example posts and
// writing samples. Styles draw on these; generators use them through a style.
import * as React from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty-state";
import {
  Brain,
  Check,
  Link,
  Plus,
  RefreshCw,
  Sparkles,
  Spinner,
  Trash,
  Type,
  Upload,
  Wand,
} from "@/components/icons";
import { SurfacePage, Tile, GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { emitAppEvent } from "@/lib/app-events";
import { fontStack, loadFontFile } from "@/lib/brand-kit/fonts";
import type { BrandKitOverview, KitAssetView, KitSection } from "@/lib/brand-kit/contracts";
import type { KitAssetKind } from "@/lib/brand-kit/spec";
import { useAddWritingSample, useKitAssetActions, useUploadKitFiles } from "./hooks";
import { DropZone, Segmented } from "./controls";
import { AnalysisDot, ExampleThumb } from "./StyleEditor";
import { Swatches, paletteList, resolveView } from "./preview";

type Props = {
  workspaceId: string;
  data: BrandKitOverview;
  section: Exclude<KitSection, "styles">;
  onCreateFrom: (assetIds: string[]) => void;
  onOpenStyle: (id: string) => void;
};

const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export function LibrarySection(props: Props) {
  switch (props.section) {
    case "logos":
      return <LogosSection {...props} />;
    case "colors":
      return <ColorsSection {...props} />;
    case "fonts":
      return <FontsSection {...props} />;
    case "elements":
      return <ElementsSection {...props} />;
    case "inspiration":
      return <ExamplesSection {...props} />;
    case "writing":
      return <WritingSection {...props} />;
  }
}

// ── Logos ───────────────────────────────────────────────────────────────────

const LOGO_SLOTS: Array<{
  kind: KitAssetKind & ("logo" | "logo_dark" | "logo_mark");
  title: string;
  hint: string;
  dark?: boolean;
}> = [
  { kind: "logo", title: "Main logo", hint: "For light backgrounds" },
  { kind: "logo_dark", title: "Logo for dark", hint: "White or light version", dark: true },
  { kind: "logo_mark", title: "Icon", hint: "Square mark or favicon" },
];

function LogosSection({ workspaceId, data }: Props) {
  const upload = useUploadKitFiles(workspaceId);
  const actions = useKitAssetActions(workspaceId);
  return (
    <SurfacePage
      title="Logos"
      subtitle="Placed on images in the corner each style chooses. PNG with a clear background works best."
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {LOGO_SLOTS.map((slot, i) => {
          const asset = data.assets.find((a) => a.kind === slot.kind);
          return (
            <motion.div
              key={slot.kind}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
            >
              <Tile className="flex h-full flex-col gap-3 p-3 sm:p-3">
                <div
                  className={cn(
                    "relative grid aspect-[4/3] place-items-center overflow-hidden rounded-[16px]",
                    slot.dark
                      ? "bg-[#111]"
                      : "bg-[repeating-conic-gradient(var(--ds-well-bg-hover)_0_25%,transparent_0_50%)] [background-size:16px_16px]",
                  )}
                >
                  {asset?.url ? (
                    <img
                      src={asset.url}
                      alt={slot.title}
                      className="max-h-[70%] max-w-[70%] object-contain"
                    />
                  ) : data.canEdit ? (
                    <DropZone
                      compact
                      multiple={false}
                      accept={IMAGE_ACCEPT}
                      busy={upload.isPending && upload.variables?.kind === slot.kind}
                      onFiles={(files) => upload.mutate({ kind: slot.kind, files })}
                      icon={Upload}
                      title="Upload"
                      className="absolute inset-2 min-h-0 border-[var(--ds-tile-border)] bg-background/60"
                    />
                  ) : (
                    <span className="text-[12px] text-muted-foreground">Not added</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 px-1">
                  <div>
                    <div className="text-[13.5px] font-medium">{slot.title}</div>
                    <div className="text-[12px] text-muted-foreground">{slot.hint}</div>
                  </div>
                  {asset && data.canEdit && (
                    <button
                      type="button"
                      className={dsIconBtn}
                      aria-label={`Remove ${slot.title}`}
                      onClick={() => actions.remove.mutate(asset.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </Tile>
            </motion.div>
          );
        })}
      </div>
      {data.dna.logoUrl && (
        <>
          <GroupLabel>From your website</GroupLabel>
          <Tile className="flex items-center gap-4">
            <div className="grid h-16 w-24 place-items-center rounded-[12px] bg-[var(--ds-well-bg)]">
              <img src={data.dna.logoUrl} alt="" className="max-h-12 max-w-20 object-contain" />
            </div>
            <div className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
              Found when Mellox read your site. Styles use it until you upload your own.
            </div>
          </Tile>
        </>
      )}
    </SurfacePage>
  );
}

// ── Colors ──────────────────────────────────────────────────────────────────

function ColorsSection({ data, onOpenStyle }: Props) {
  const styles = data.styles.filter((s) => !s.archived);
  return (
    <SurfacePage
      title="Colors"
      subtitle="Brand DNA holds your main colors. Each style can follow them or use its own."
      actions={
        <button
          type="button"
          className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
          onClick={() => emitAppEvent("open:brand-dna", { tab: "colors" })}
        >
          <Brain className="h-4 w-4" /> Edit in Brand DNA
        </button>
      }
    >
      <Tile>
        <div className="ds-label mb-3">Brand DNA</div>
        {data.dna.colors.length ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.dna.colors.map((c, i) => (
              <motion.div
                key={`${c.hex}-${i}`}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.04 }}
              >
                <CopySwatch hex={c.hex} name={c.name} />
              </motion.div>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No colors in Brand DNA yet.</p>
        )}
      </Tile>
      <GroupLabel>In your styles</GroupLabel>
      <div className="space-y-2">
        {styles.map((s) => {
          const r = resolveView(s, data.dna);
          const own = !!s.spec.visual?.palette?.primary;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onOpenStyle(s.id)}
              className="ds-tile ds-tile-hover flex w-full items-center gap-4 p-3 text-left"
            >
              <Swatches colors={paletteList(r)} size={26} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{s.name}</div>
                <div className="text-[12px] text-muted-foreground">
                  {own ? "Own colors" : "Follows Brand DNA"}
                </div>
              </div>
            </button>
          );
        })}
        {!styles.length && <p className="text-[13px] text-muted-foreground">No styles yet.</p>}
      </div>
    </SurfacePage>
  );
}

function CopySwatch({ hex, name }: { hex: string; name?: string }) {
  const [copied, setCopied] = React.useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(hex);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="group w-full text-left"
    >
      <div
        className="relative aspect-[4/3] rounded-[14px] ring-1 ring-black/5 transition-transform group-hover:scale-[1.03]"
        style={{ background: hex }}
      >
        {copied && (
          <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/30 text-white">
            <Check className="h-5 w-5" />
          </span>
        )}
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium">{name || "Color"}</div>
      <div className="font-mono text-[11px] uppercase text-muted-foreground">{hex}</div>
    </button>
  );
}

// ── Fonts ───────────────────────────────────────────────────────────────────

function FontsSection({ workspaceId, data }: Props) {
  const upload = useUploadKitFiles(workspaceId);
  const actions = useKitAssetActions(workspaceId);
  const fonts = data.assets.filter((a) => a.kind === "font_file");
  React.useEffect(() => {
    for (const f of fonts) if (f.url && f.label) void loadFontFile(f.label, f.url);
  }, [fonts]);
  return (
    <SurfacePage
      title="Fonts"
      subtitle="Upload your own fonts, or pick any Google Font inside a style."
    >
      {data.canEdit && (
        <DropZone
          accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf"
          onFiles={(files) => upload.mutate({ kind: "font_file", files })}
          busy={upload.isPending}
          icon={Type}
          title="Upload font files"
          hint="WOFF2, WOFF, TTF or OTF, up to 2 MB. Only upload fonts you're licensed to use."
        />
      )}
      {fonts.length > 0 && (
        <>
          <GroupLabel>Your fonts</GroupLabel>
          <div className="grid gap-3 sm:grid-cols-2">
            {fonts.map((f) => (
              <Tile key={f.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <InlineLabel
                    value={f.label ?? ""}
                    placeholder="Font name"
                    disabled={!data.canEdit}
                    onSave={(label) => actions.update.mutate({ assetId: f.id, label })}
                  />
                  {data.canEdit && (
                    <button
                      type="button"
                      className={dsIconBtn}
                      aria-label="Remove font"
                      onClick={() => actions.remove.mutate(f.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div
                  className="truncate text-[28px] leading-tight"
                  style={{ fontFamily: fontStack(f.label) }}
                >
                  Aa Bb Cc 123
                </div>
                <div
                  className="truncate text-[14px] text-muted-foreground"
                  style={{ fontFamily: fontStack(f.label) }}
                >
                  The quick brown fox jumps over the lazy dog
                </div>
              </Tile>
            ))}
          </div>
        </>
      )}
      {data.dna.fonts.length > 0 && (
        <>
          <GroupLabel>In Brand DNA</GroupLabel>
          <div className="flex flex-wrap gap-2">
            {data.dna.fonts.map((f) => (
              <span
                key={f}
                className="ds-well px-4 py-2 text-[15px]"
                style={{ fontFamily: fontStack(f) }}
              >
                {f}
              </span>
            ))}
          </div>
        </>
      )}
    </SurfacePage>
  );
}

function InlineLabel({
  value,
  placeholder,
  disabled,
  onSave,
}: {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onSave: (v: string) => void;
}) {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value.slice(0, 120))}
      onBlur={() => text.trim() !== value && onSave(text.trim())}
      onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      className="min-w-0 flex-1 rounded-[10px] bg-transparent px-1.5 py-1 text-[13.5px] font-medium outline-none hover:bg-[var(--ds-well-bg)] focus:bg-[var(--ds-well-bg)]"
    />
  );
}

// ── Elements ────────────────────────────────────────────────────────────────

type ElementKind = "element" | "pattern" | "product_photo";
const ELEMENT_TABS: Array<{ value: ElementKind; label: string; hint: string }> = [
  { value: "element", label: "Elements", hint: "Stickers, icons, shapes, mascots" },
  { value: "pattern", label: "Patterns", hint: "Backgrounds and textures" },
  { value: "product_photo", label: "Products", hint: "Clean photos of what you sell" },
];

function ElementsSection({ workspaceId, data }: Props) {
  const [kind, setKind] = React.useState<ElementKind>("element");
  const upload = useUploadKitFiles(workspaceId);
  const actions = useKitAssetActions(workspaceId);
  const items = data.assets.filter((a) => a.kind === kind);
  const tab = ELEMENT_TABS.find((t) => t.value === kind)!;
  return (
    <SurfacePage
      title="Elements"
      subtitle="The pieces that make your posts yours."
      actions={
        <Segmented
          value={kind}
          onChange={(v) => v && setKind(v)}
          options={ELEMENT_TABS.map(({ value, label }) => ({ value, label }))}
        />
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.canEdit && (
          <DropZone
            compact
            accept={IMAGE_ACCEPT}
            onFiles={(files) => upload.mutate({ kind, files })}
            busy={upload.isPending}
            icon={Plus}
            title={`Add ${tab.label.toLowerCase()}`}
            hint={tab.hint}
            className="aspect-square min-h-0"
          />
        )}
        {items.map((a, i) => (
          <motion.div
            key={a.id}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: Math.min(i, 12) * 0.03 }}
            className="group relative"
          >
            <div className="aspect-square overflow-hidden rounded-[16px] bg-[repeating-conic-gradient(var(--ds-well-bg-hover)_0_25%,transparent_0_50%)] [background-size:14px_14px] ring-1 ring-[var(--ds-tile-border)]">
              {a.url && (
                <img
                  src={a.url}
                  alt={a.label ?? ""}
                  loading="lazy"
                  className={cn(
                    "h-full w-full",
                    kind === "pattern" ? "object-cover" : "object-contain p-3",
                  )}
                />
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <InlineLabel
                value={a.label ?? ""}
                placeholder="Name"
                disabled={!data.canEdit}
                onSave={(label) => actions.update.mutate({ assetId: a.id, label })}
              />
              {data.canEdit && (
                <button
                  type="button"
                  className={cn(dsIconBtn, "h-7 w-7 opacity-0 group-hover:opacity-100")}
                  aria-label="Remove"
                  onClick={() => actions.remove.mutate(a.id)}
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </motion.div>
        ))}
      </div>
      {!items.length && !data.canEdit && <EmptyState title={`No ${tab.label.toLowerCase()} yet`} />}
    </SurfacePage>
  );
}

// ── Examples ────────────────────────────────────────────────────────────────

function ExamplesSection({ workspaceId, data, onCreateFrom }: Props) {
  const upload = useUploadKitFiles(workspaceId);
  const actions = useKitAssetActions(workspaceId);
  const items = data.assets.filter(
    (a) => a.kind === "inspiration_image" || a.kind === "inspiration_video",
  );
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<KitAssetView | null>(null);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const onFiles = (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const videos = files.filter((f) => f.type.startsWith("video/"));
    if (images.length) upload.mutate({ kind: "inspiration_image", files: images });
    if (videos.length) upload.mutate({ kind: "inspiration_video", files: videos });
  };
  const failed = items.filter((a) => a.analysisStatus === "failed" || a.stale);
  return (
    <SurfacePage
      title="Examples"
      subtitle="Posts, ads and videos you want to look like. Mellox studies each one."
      actions={
        <>
          {failed.length > 0 && data.canEdit && (
            <button
              type="button"
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              onClick={() => actions.reanalyze.mutate(failed.map((a) => a.id).slice(0, 12))}
            >
              <RefreshCw className="h-4 w-4" /> Try again ({failed.length})
            </button>
          )}
          {selected.size > 0 && data.canEdit && (
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              onClick={() => onCreateFrom([...selected])}
            >
              <Wand className="h-4 w-4" /> Make a style from {selected.size}
            </button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {data.canEdit && (
          <DropZone
            compact
            accept={`${IMAGE_ACCEPT},video/mp4,video/webm,video/quicktime`}
            onFiles={onFiles}
            busy={upload.isPending}
            title="Add examples"
            hint="Images or short videos"
            className="aspect-square min-h-0"
          />
        )}
        {items.map((a, i) => {
          const on = selected.has(a.id);
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 12) * 0.03 }}
              className="group relative"
            >
              <button type="button" className="block w-full text-left" onClick={() => setOpen(a)}>
                <ExampleThumb
                  asset={a}
                  className={cn("transition-all", on && "ring-2 ring-primary")}
                />
              </button>
              {data.canEdit && (
                <button
                  type="button"
                  aria-label={on ? "Unselect" : "Select"}
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full ring-2 ring-white transition-all",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "bg-black/30 text-transparent opacity-0 group-hover:opacity-100",
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
              )}
              <div className="mt-1.5 line-clamp-1 px-0.5 text-[12px] text-muted-foreground">
                {statusText(a)}
              </div>
            </motion.div>
          );
        })}
      </div>
      {open && (
        <ExampleDetail
          asset={open}
          canEdit={data.canEdit}
          onClose={() => setOpen(null)}
          workspaceId={workspaceId}
        />
      )}
    </SurfacePage>
  );
}

function statusText(a: KitAssetView): string {
  if (a.stale) return "Took too long. Try again.";
  if (a.analysisStatus === "pending" || a.analysisStatus === "running") return "Reading the style…";
  if (a.analysisStatus === "failed") return a.analysisError ?? "Couldn't read this one";
  if (a.analysisStatus === "done") return a.analysis?.summary ?? "Learned";
  return a.label ?? "";
}

function ExampleDetail({
  asset,
  canEdit,
  onClose,
  workspaceId,
}: {
  asset: KitAssetView;
  canEdit: boolean;
  onClose: () => void;
  workspaceId: string;
}) {
  const actions = useKitAssetActions(workspaceId);
  const v = asset.analysis?.visual;
  const rows: Array<[string, string | undefined]> = [
    ["Kind", v?.medium],
    ["Mood", v?.mood],
    ["Light", v?.lighting],
    ["Color feel", v?.grading],
    ["Layout", v?.composition],
    [
      "Fonts",
      [v?.typography?.heading, v?.typography?.body].filter(Boolean).join(", ") || undefined,
    ],
    ["Details", v?.elements?.join(", ")],
    ["Pace", asset.analysis?.video?.pacing],
    ["Shots", asset.analysis?.video?.shots],
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-6">
      <Tile className="grid gap-5 sm:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          {asset.kind === "inspiration_video" && asset.url ? (
            <video src={asset.url} controls className="w-full rounded-[14px]" />
          ) : (
            <ExampleThumb asset={asset} />
          )}
          {asset.frameUrls.length > 1 && (
            <div className="grid grid-cols-4 gap-1">
              {asset.frameUrls.map((u) => (
                <img key={u} src={u} alt="" className="aspect-square rounded-[8px] object-cover" />
              ))}
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <div className="text-[14px] font-semibold">What Mellox learned</div>
              {asset.analysis?.summary && (
                <p className="mt-1 text-[13px] text-muted-foreground">{asset.analysis.summary}</p>
              )}
            </div>
            <button type="button" className={dsIconBtn} onClick={onClose} aria-label="Close">
              ×
            </button>
          </div>
          {asset.analysis?.colors?.length ? (
            <Swatches colors={asset.analysis.colors} size={24} className="mb-4" />
          ) : null}
          {asset.analysisStatus === "done" ? (
            <dl className="grid gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-[110px_1fr]">
              {rows
                .filter(([, val]) => val)
                .map(([k, val]) => (
                  <React.Fragment key={k}>
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="text-foreground/90">{val}</dd>
                  </React.Fragment>
                ))}
            </dl>
          ) : (
            <p className="text-[13px] text-muted-foreground">{statusText(asset)}</p>
          )}
          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {(asset.analysisStatus === "failed" ||
                asset.stale ||
                asset.analysisStatus === "done") && (
                <button
                  type="button"
                  className={cn(dsGhostBtn, "h-8 px-3.5 text-[12.5px]")}
                  onClick={() => actions.reanalyze.mutate([asset.id])}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Read again
                </button>
              )}
              <button
                type="button"
                className={cn(
                  dsGhostBtn,
                  "h-8 px-3.5 text-[12.5px] text-destructive hover:text-destructive",
                )}
                onClick={() => {
                  actions.remove.mutate(asset.id);
                  onClose();
                }}
              >
                <Trash className="h-3.5 w-3.5" /> Remove
              </button>
            </div>
          )}
        </div>
      </Tile>
    </motion.div>
  );
}

// ── Writing samples ─────────────────────────────────────────────────────────

function WritingSection({ workspaceId, data, onCreateFrom }: Props) {
  const add = useAddWritingSample(workspaceId);
  const actions = useKitAssetActions(workspaceId);
  const [mode, setMode] = React.useState<"text" | "link">("text");
  const [text, setText] = React.useState("");
  const [url, setUrl] = React.useState("");
  const samples = data.assets.filter((a) => a.kind === "writing_sample");
  const learned = samples.filter((s) => s.analysisStatus === "done");
  const submit = () => {
    if (mode === "text" && text.trim().length >= 40)
      add.mutate({ text }, { onSuccess: () => setText("") });
    if (mode === "link" && url.trim())
      add.mutate({ url: url.trim() }, { onSuccess: () => setUrl("") });
  };
  return (
    <SurfacePage
      title="Writing"
      subtitle="Posts, captions or emails that sound like you. Mellox learns the voice, not the facts."
      actions={
        learned.length > 0 && data.canEdit ? (
          <button
            type="button"
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
            onClick={() => onCreateFrom(learned.map((s) => s.id))}
          >
            <Wand className="h-4 w-4" /> Make a style from these
          </button>
        ) : null
      }
    >
      {data.canEdit && (
        <Tile className="space-y-3">
          <Segmented
            size="sm"
            value={mode}
            onChange={(v) => v && setMode(v)}
            options={[
              { value: "text", label: "Paste text" },
              { value: "link", label: "From a link" },
            ]}
          />
          {mode === "text" ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, 20_000))}
              rows={5}
              placeholder="Paste one or more posts you wrote. The more, the better."
              className="ds-well w-full resize-y px-4 py-3 text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/70"
            />
          ) : (
            <div className="ds-well flex items-center gap-2 px-4">
              <Link className="h-4 w-4 text-muted-foreground" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://your-blog.com/a-post-you-like"
                className="h-11 flex-1 bg-transparent text-[13.5px] outline-none"
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] text-muted-foreground">
              {mode === "text"
                ? `${text.trim().length.toLocaleString()} characters`
                : "Public pages only. Some social sites hide the text; paste it instead."}
            </span>
            <button
              type="button"
              className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              disabled={add.isPending || (mode === "text" ? text.trim().length < 40 : !url.trim())}
              onClick={submit}
            >
              {add.isPending ? (
                <Spinner className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Add sample
            </button>
          </div>
        </Tile>
      )}
      {samples.length > 0 && (
        <>
          <GroupLabel>Samples</GroupLabel>
          <ul className="space-y-2">
            {samples.map((s, i) => (
              <motion.li
                key={s.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 10) * 0.03 }}
                className="ds-tile flex items-start gap-3 p-4"
              >
                <AnalysisDot asset={s} />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-3 whitespace-pre-line text-[13px] text-foreground/85">
                    {s.textContent}
                  </div>
                  <div className="mt-1.5 text-[12px] text-muted-foreground">{statusText(s)}</div>
                  {s.analysis?.writing?.tone && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {toneChips(s.analysis.writing.tone).map((t) => (
                        <span key={t} className="ds-well px-2.5 py-0.5 text-[11.5px]">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                {data.canEdit && (
                  <div className="flex shrink-0 gap-1">
                    {(s.analysisStatus === "failed" || s.stale) && (
                      <button
                        type="button"
                        className={dsIconBtn}
                        aria-label="Read again"
                        onClick={() => actions.reanalyze.mutate([s.id])}
                      >
                        <RefreshCw className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      className={dsIconBtn}
                      aria-label="Remove sample"
                      onClick={() => actions.remove.mutate(s.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </motion.li>
            ))}
          </ul>
        </>
      )}
    </SurfacePage>
  );
}

function toneChips(tone: {
  casual?: number;
  playful?: number;
  detailed?: number;
  bold?: number;
}): string[] {
  const pick = (v: number | undefined, low: string, high: string) =>
    v == null ? null : v >= 60 ? high : v <= 40 ? low : null;
  return [
    pick(tone.casual, "Formal", "Casual"),
    pick(tone.playful, "Serious", "Playful"),
    pick(tone.detailed, "Short", "Detailed"),
    pick(tone.bold, "Quiet", "Bold"),
  ].filter((x): x is string => !!x);
}

"use client";

// Inspo → Media: the brand's own product shots, people, clips and website
// captures, kept in folders with the person's own labels. Studio, Write it
// for me, Autopilot and campaigns read the folders and labels: a brief that
// names "the launch event photos" is made with exactly those
// (src/lib/inspo/media-library.ts). Photos are designed around, never redrawn.
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Folder,
  Monitor,
  Palette,
  Pencil,
  Play,
  Plus,
  ShoppingBag,
  Trash,
  User,
  Wand,
  X,
} from "@/components/icons";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MEDIA_CHIPS, shelfCards, type InspoCard, type InspoChip } from "@/lib/inspo/board";
import { mediaFolders } from "@/lib/inspo/media-library";
import {
  frequencyOf,
  type MediaLifetime,
  type OwnMediaFrequency,
} from "@/lib/inspo/media-rotation";
import { cn } from "@/lib/utils";
import { CHIP_ICON, EASE, InspoDrop, UploadCardView } from "./parts";
import type { InspoHandlers, InspoView } from "./types";

const USE_OPTIONS: Array<{ value: OwnMediaFrequency; label: string }> = [
  { value: "rarely", label: "Rarely" },
  { value: "sometimes", label: "Sometimes" },
  { value: "often", label: "Often" },
];

type Filter =
  | { kind: "all" }
  | { kind: "chip"; chip: "product" | "person" | "element" }
  | { kind: "website" }
  | { kind: "folder"; name: string };

const same = (a: Filter, b: Filter) =>
  a.kind === b.kind &&
  (a.kind !== "folder" || a.name === (b as { name: string }).name) &&
  (a.kind !== "chip" || a.chip === (b as { chip: string }).chip);

function Segment<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div className="ds-well inline-flex shrink-0 p-0.5" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-semibold transition-colors",
              on
                ? "bg-[var(--ds-tile-bg)] text-foreground shadow-sm ring-1 ring-primary/30"
                : "text-muted-foreground hover:text-foreground",
              dsFocus,
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label, folder and how long to keep one item. Saved on "Save". */
function MediaEditor({
  card,
  folders,
  onSave,
  onClose,
}: {
  card: InspoCard;
  folders: string[];
  onSave: (patch: {
    label: string;
    folder: string | null;
    lifetime: MediaLifetime;
    chip: InspoChip;
  }) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = React.useState(card.notes);
  const [folder, setFolder] = React.useState<string>(card.folder ?? "");
  const [lifetime, setLifetime] = React.useState<MediaLifetime>(card.lifetime);
  const [chip, setChip] = React.useState<InspoChip>(card.chip);
  const listId = React.useId();
  return (
    <form
      className="w-[300px] space-y-3.5"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ label: label.trim(), folder: folder.trim() || null, lifetime, chip });
        onClose();
      }}
    >
      <label className="block space-y-1.5">
        <span className="text-[12px] font-semibold text-muted-foreground">What is it?</span>
        <textarea
          value={label}
          onChange={(e) => setLabel(e.target.value.slice(0, 300))}
          rows={2}
          autoFocus
          placeholder="e.g. Ribbon cutting at our Lahore store launch"
          className="w-full resize-none rounded-[14px] bg-[var(--ds-well-bg)] px-3 py-2 text-[13px] outline-none ring-1 ring-transparent focus:ring-primary/50"
        />
        <span className="block text-[11px] text-muted-foreground">
          Mox uses this to pick the right photo for the right post.
        </span>
      </label>
      <label className="block space-y-1.5">
        <span className="text-[12px] font-semibold text-muted-foreground">Folder</span>
        <input
          value={folder}
          list={listId}
          onChange={(e) => setFolder(e.target.value.slice(0, 60))}
          placeholder="e.g. Launch event"
          className="h-9 w-full rounded-full bg-[var(--ds-well-bg)] px-3.5 text-[13px] outline-none ring-1 ring-transparent focus:ring-primary/50"
        />
        <datalist id={listId}>
          {folders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        {folders.length > 0 && (
          <span className="flex flex-wrap gap-1.5 pt-0.5">
            {folders.slice(0, 6).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFolder(f)}
                className={cn(
                  "inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ring-1 transition-colors",
                  folder === f
                    ? "bg-primary/15 ring-primary/40"
                    : "ring-[var(--ds-tile-border)] text-muted-foreground hover:text-foreground",
                )}
              >
                <Folder className="h-3 w-3" /> {f}
              </button>
            ))}
          </span>
        )}
      </label>
      {!card.capture && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-muted-foreground">It shows</span>
          <Segment
            label="It shows"
            value={chip === "person" || chip === "element" ? chip : "product"}
            options={[
              { value: "product", label: "Product" },
              { value: "person", label: "People" },
              { value: "element", label: "Art" },
            ]}
            onChange={(v) => setChip(v)}
          />
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-muted-foreground">Keep it</span>
        <Segment
          label="Keep it"
          value={lifetime}
          options={[
            { value: "permanent", label: "Always" },
            { value: "temporary", label: "For now" },
          ]}
          onChange={setLifetime}
        />
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">
        {lifetime === "temporary"
          ? "For now: an event or a season. Used a couple of times in the next 30 days, then left alone."
          : "Always: your product, team or place. Comes back now and then."}
      </p>
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onClose} className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}>
          Cancel
        </button>
        <button
          type="submit"
          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-4 text-[12px] font-semibold text-primary-foreground"
        >
          <Check className="h-3.5 w-3.5" /> Save
        </button>
      </div>
    </form>
  );
}

function MediaTile({
  card,
  index,
  canEdit,
  folders,
  handlers,
}: {
  card: InspoCard;
  index: number;
  canEdit: boolean;
  folders: string[];
  handlers: InspoHandlers;
}) {
  const [editing, setEditing] = React.useState(false);
  const video = React.useRef<HTMLVideoElement>(null);
  // Site art keeps the site's own words for it (alt text) until a person labels it.
  const label = card.notes.trim() || (card.chip === "element" ? card.label : "");
  const Icon = card.capture ? Monitor : CHIP_ICON[card.chip];
  const art = card.chip === "element" && !card.capture;
  return (
    <motion.figure
      layout="position"
      initial={{ opacity: 0, y: 14, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.18 } }}
      transition={{ duration: 0.4, delay: Math.min(index, 12) * 0.025, ease: EASE }}
      className="group relative flex flex-col overflow-hidden rounded-[22px] bg-[var(--ds-tile-bg)] ring-1 ring-[var(--ds-tile-border)] transition-shadow hover:shadow-[var(--ds-tile-shadow-hover)]"
      data-testid="inspo-card"
    >
      <div
        className={cn(
          "relative w-full overflow-hidden bg-[var(--ds-well-bg)]",
          card.capture ? "aspect-[3/4]" : "aspect-square",
        )}
      >
        {card.kind === "video" ? (
          <>
            <video
              ref={video}
              src={card.url ?? undefined}
              muted
              loop
              playsInline
              preload="metadata"
              className="size-full object-cover"
              onMouseEnter={() => void video.current?.play().catch(() => {})}
              onMouseLeave={() => video.current?.pause()}
            />
            <span className="pointer-events-none absolute left-1/2 top-1/2 grid h-10 w-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-opacity group-hover:opacity-0">
              <Play className="h-4 w-4" />
            </span>
          </>
        ) : card.thumbUrl ? (
          <img
            src={card.thumbUrl}
            alt={label || card.label}
            loading="lazy"
            decoding="async"
            className={cn(
              "size-full transition-transform duration-[1600ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
              card.capture
                ? "object-cover object-top group-hover:object-bottom"
                : art
                  ? "object-contain p-3 group-hover:scale-[1.04]"
                  : "object-cover group-hover:scale-[1.05]",
            )}
          />
        ) : null}
        <span className="absolute left-2 top-2 inline-flex h-6 items-center gap-1 rounded-full bg-black/45 px-2 text-[11px] font-semibold text-white backdrop-blur">
          <Icon className="h-3 w-3" />
          {card.capture
            ? "Website"
            : card.chip === "person"
              ? "People"
              : art
                ? "Site art"
                : "Product"}
        </span>
        {card.lifetime === "temporary" && !card.capture && (
          <span className="absolute right-2 top-2 inline-flex h-6 items-center rounded-full bg-amber-500/80 px-2 text-[11px] font-semibold text-white backdrop-blur">
            For now
          </span>
        )}
        {canEdit && (
          <div className="absolute inset-x-2 bottom-2 flex translate-y-2 items-center justify-end gap-1 opacity-0 transition-all duration-300 group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100 [@media(hover:none)]:translate-y-0 [@media(hover:none)]:opacity-100">
            <button
              type="button"
              onClick={() => handlers.useInPost(card)}
              className={cn(
                "inline-flex h-8 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground shadow-sm transition-transform hover:scale-[1.04]",
                dsFocus,
              )}
            >
              <Wand className="h-3.5 w-3.5" /> Use
            </button>
            <button
              type="button"
              aria-label="Remove"
              onClick={() => handlers.remove(card)}
              className={cn(
                "grid size-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition-colors hover:bg-black/60",
                dsFocus,
              )}
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <Popover open={editing} onOpenChange={setEditing}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={!canEdit}
            className={cn(
              "flex w-full items-start gap-2 px-3 py-2.5 text-left transition-colors hover:bg-[var(--ds-well-bg)] disabled:hover:bg-transparent",
              dsFocus,
            )}
          >
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[12.5px] font-semibold",
                  !label && "text-muted-foreground",
                )}
              >
                {label || (canEdit ? "Add a label" : card.label)}
              </span>
              <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                <Folder className="h-3 w-3 shrink-0" />
                {card.folder ?? "No folder"}
              </span>
            </span>
            {canEdit && <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="rounded-[22px] p-4">
          <MediaEditor
            card={card}
            folders={folders}
            onClose={() => setEditing(false)}
            onSave={(patch) => handlers.setDetails(card, patch)}
          />
        </PopoverContent>
      </Popover>
    </motion.figure>
  );
}

export function Media({ view, handlers }: { view: InspoView; handlers: InspoHandlers }) {
  const [addAs, setAddAs] = React.useState<InspoChip>("product");
  const [filter, setFilter] = React.useState<Filter>({ kind: "all" });
  const [newFolder, setNewFolder] = React.useState<string | null>(null);
  const canEdit = !!view.taste?.canEdit;
  const media = shelfCards(view.cards, "media");
  const folders = mediaFolders(media);
  const folderNames = folders.map((f) => f.name);
  const uploads = view.uploads.filter(
    (u) => u.chip === "product" || u.chip === "person" || u.chip === "element",
  );
  const captures = media.filter((c) => c.capture);
  // New uploads go into the folder on screen.
  const intoFolder = filter.kind === "folder" ? filter.name : undefined;

  // Pictures the scan found on the site (the old Assets list), ready to keep.
  const known = new Set(view.cards.map((c) => c.label));
  const keptUrls = new Set(view.cards.flatMap((c) => (c.sourceUrl ? [c.sourceUrl] : [])));
  const fromSite = view.dna.assets
    .filter((a) => (a.kind === "image" || a.kind === "design") && /^https?:\/\//.test(a.url))
    .filter((a) => !known.has(a.label) && !keptUrls.has(a.url))
    .slice(0, 8);

  const shown = media.filter((c) =>
    filter.kind === "all"
      ? true
      : filter.kind === "website"
        ? c.capture
        : filter.kind === "chip"
          ? !c.capture && c.chip === filter.chip
          : c.folder === filter.name,
  );

  const pills: Array<{ filter: Filter; label: string; count: number; icon?: React.ReactNode }> = [
    { filter: { kind: "all" }, label: "All", count: media.length },
    {
      filter: { kind: "chip", chip: "product" },
      label: "Products",
      count: media.filter((c) => !c.capture && c.chip === "product").length,
      icon: <ShoppingBag className="h-3.5 w-3.5" />,
    },
    {
      filter: { kind: "chip", chip: "person" },
      label: "People",
      count: media.filter((c) => !c.capture && c.chip === "person").length,
      icon: <User className="h-3.5 w-3.5" />,
    },
    ...(media.some((c) => !c.capture && c.chip === "element")
      ? [
          {
            filter: { kind: "chip", chip: "element" } as Filter,
            label: "Site art",
            count: media.filter((c) => !c.capture && c.chip === "element").length,
            icon: <Palette className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...(captures.length
      ? [
          {
            filter: { kind: "website" } as Filter,
            label: "Website",
            count: captures.length,
            icon: <Monitor className="h-3.5 w-3.5" />,
          },
        ]
      : []),
    ...folders.map((f) => ({
      filter: { kind: "folder", name: f.name } as Filter,
      label: f.name,
      count: f.count,
      icon: <Folder className="h-3.5 w-3.5" />,
    })),
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[160px_minmax(0,1fr)]">
        <button
          type="button"
          onClick={() => handlers.openBrand("logo")}
          className={cn(
            "group flex flex-col items-center justify-center gap-3 rounded-[28px] bg-[var(--ds-tile-bg)] p-4 ring-1 ring-[var(--ds-tile-border)] transition-all hover:-translate-y-0.5 hover:ring-primary/40",
            dsFocus,
          )}
        >
          <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-[20px] bg-[var(--ds-well-bg)]">
            {view.dna.logoUrl ? (
              <img src={view.dna.logoUrl} alt="Logo" className="max-h-16 max-w-16 object-contain" />
            ) : (
              <Plus className="h-5 w-5 text-muted-foreground" />
            )}
          </span>
          <span className="text-[12.5px] font-semibold">Logo</span>
        </button>
        <div className="space-y-2.5">
          <InspoDrop
            compact
            title={
              intoFolder
                ? `Add to "${intoFolder}"`
                : addAs === "person"
                  ? "Add photos of your people"
                  : addAs === "element"
                    ? "Add your artwork, characters & mascots"
                    : "Add product photos & clips"
            }
            disabled={!canEdit}
            onFiles={(files) => handlers.upload(files, addAs, intoFolder)}
            onLink={(url) => handlers.addLink(url, addAs)}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="ds-well inline-flex p-0.5">
              {MEDIA_CHIPS.map((chip) => {
                const Icon = CHIP_ICON[chip];
                const on = addAs === chip;
                return (
                  <button
                    key={chip}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAddAs(chip)}
                    className={cn(
                      "relative inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold transition-colors",
                      on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                      dsFocus,
                    )}
                  >
                    {on && (
                      <motion.span
                        layoutId="inspo-media-as"
                        className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-primary/30"
                        transition={{ type: "spring", stiffness: 420, damping: 34 }}
                      />
                    )}
                    <Icon className="relative h-3.5 w-3.5" />
                    <span className="relative">
                      {chip === "product" ? "Product" : chip === "person" ? "People" : "Art"}
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => handlers.openBrand("products")}
              className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
            >
              <ShoppingBag className="h-3.5 w-3.5" /> Products <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] bg-[var(--ds-well-bg)] px-4 py-3">
        <div className="min-w-0 max-w-[560px]">
          <p className="text-[13px] font-semibold">Use my media in new posts</p>
          <p className="text-xs text-muted-foreground">
            Name a folder or label in a brief (&ldquo;use the launch event photos&rdquo;) and Mox
            uses exactly those. Otherwise Autopilot, campaigns and Write it for me add them to some
            posts, never two in a row.
          </p>
        </div>
        <Segment
          label="How often"
          value={frequencyOf(view.look.visual?.ownMedia)}
          options={USE_OPTIONS}
          disabled={!canEdit}
          onChange={(ownMedia) =>
            handlers.saveLook({ ...view.look, visual: { ...view.look.visual, ownMedia } })
          }
        />
      </div>

      {(media.length > 0 || canEdit) && (
        <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
          {pills.map((p) => {
            const on = same(filter, p.filter);
            return (
              <button
                key={p.filter.kind + p.label}
                type="button"
                aria-pressed={on}
                onClick={() => setFilter(p.filter)}
                className={cn(
                  "relative inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors",
                  on ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                  dsFocus,
                )}
              >
                {on && (
                  <motion.span
                    layoutId="inspo-media-filter"
                    className="absolute inset-0 rounded-full bg-[var(--ds-tile-bg)] shadow-sm ring-1 ring-primary/30"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span className="relative inline-flex items-center gap-1.5">
                  {p.icon}
                  {p.label}
                  <span className="text-[11px] font-medium text-muted-foreground">{p.count}</span>
                </span>
              </button>
            );
          })}
          {canEdit &&
            (newFolder === null ? (
              <button
                type="button"
                onClick={() => setNewFolder("")}
                className={cn(
                  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[var(--ds-tile-border)] px-3.5 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground",
                  dsFocus,
                )}
              >
                <Plus className="h-3.5 w-3.5" /> New folder
              </button>
            ) : (
              <form
                className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-[var(--ds-tile-bg)] pl-3 pr-1 ring-1 ring-primary/40"
                onSubmit={(e) => {
                  e.preventDefault();
                  const name = newFolder.replace(/\s+/g, " ").trim().slice(0, 60);
                  if (name) setFilter({ kind: "folder", name });
                  setNewFolder(null);
                }}
              >
                <Folder className="h-3.5 w-3.5 text-muted-foreground" />
                <input
                  autoFocus
                  value={newFolder}
                  onChange={(e) => setNewFolder(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setNewFolder(null)}
                  placeholder="Launch event"
                  className="w-32 bg-transparent text-[12.5px] outline-none"
                />
                <button
                  type="submit"
                  aria-label="Create folder"
                  className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground"
                >
                  <Check className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  onClick={() => setNewFolder(null)}
                  className="grid size-6 place-items-center rounded-full text-muted-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              </form>
            ))}
        </div>
      )}

      {filter.kind === "folder" && !folderNames.includes(filter.name) && (
        <p className="rounded-[18px] bg-[var(--ds-well-bg)] px-4 py-3 text-[12.5px] text-muted-foreground">
          &ldquo;{filter.name}&rdquo; is ready. Drop photos above to add them here, or open any
          photo&rsquo;s label to move it in.
        </p>
      )}

      {fromSite.length > 0 && canEdit && filter.kind === "all" && (
        <div className="space-y-2">
          <div className="text-[12px] font-semibold text-muted-foreground">Found on your site</div>
          <div className="flex gap-2.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {fromSite.map((a, i) => (
              <motion.button
                key={a.id}
                type="button"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04, duration: 0.35, ease: EASE }}
                onClick={() => handlers.addLink(a.url, addAs)}
                className={cn(
                  "group relative h-24 w-24 shrink-0 overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]",
                  dsFocus,
                )}
                aria-label={`Keep ${a.label}`}
              >
                <img src={a.url} alt="" loading="lazy" className="size-full object-cover" />
                <span className="absolute inset-0 grid place-items-center bg-black/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
                  <Plus className="h-5 w-5" />
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {(shown.length > 0 || uploads.length > 0) && (
        <div
          className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4"
          data-testid="inspo-media"
        >
          <AnimatePresence mode="popLayout" initial={false}>
            {uploads.map((u) => (
              <UploadCardView key={u.id} upload={u} />
            ))}
            {shown.map((card, i) => (
              <MediaTile
                key={card.id}
                card={card}
                index={i}
                canEdit={canEdit}
                folders={folderNames}
                handlers={handlers}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

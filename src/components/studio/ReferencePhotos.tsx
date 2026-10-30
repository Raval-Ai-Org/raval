"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  Check,
  Image as ImageIcon,
  Lightbulb,
  Palette,
  Pencil,
  Plus,
  Spinner,
  X,
  type LucideIcon,
} from "@/components/icons";
import { FieldLabel, OptionCards, SwitchRow } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { isPhotoDesignType, photoLimit, photoModeOptions } from "@/lib/studio/photo-design/mode";

type Photo = { id: string; filename: string; url: string };
type Mode = NonNullable<StudioControls["referenceMode"]>;
type Fidelity = NonNullable<StudioControls["photoFidelity"]>;

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MODE_ICON: Record<Mode, LucideIcon> = {
  design: Palette,
  preserve: ImageIcon,
  edit: Pencil,
  inspire: Lightbulb,
  // Set by the server for a catalogue product; never offered here.
  hero: Palette,
};

/**
 * The brand's own photos: add them first, then choose what Mellox does with
 * them. Uploads are source material; nothing is generated or charged here.
 */
export function ReferencePhotos({
  workspaceId,
  type,
  value,
  mode,
  fidelity,
  onChange,
  onModeChange,
  onFidelityChange,
  disabled,
  onBusyChange,
  limit: fixedLimit,
  hideModes,
  title = "Your photos",
  note,
  bare,
}: {
  workspaceId: string;
  /** The Studio type, which decides the modes on offer. */
  type: string;
  value: string[];
  mode: Mode;
  fidelity: Fidelity;
  onChange: (ids: string[]) => void;
  onModeChange: (mode: Mode) => void;
  onFidelityChange: (fidelity: Fidelity) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  /** A recap video takes its own number of photos and no photo modes. */
  limit?: number;
  hideModes?: boolean;
  title?: string;
  /** Replaces "Optional" when the photos are needed. */
  note?: string;
  bare?: boolean;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  // A single picture can take more photos once it designs with them, so adding
  // a second photo is never blocked by "Post as is" (it switches to designing).
  const limit =
    fixedLimit ?? (isPhotoDesignType(type) ? photoLimit("design", type) : photoLimit(mode, type));
  const single = limit === 1;
  const full = !single && value.length >= limit;

  useEffect(() => {
    const request = ++generation.current;
    setPhotos([]);
    setError(null);
    void (async () => {
      try {
        const response = await authedFetch(`/api/studio/references?workspaceId=${workspaceId}`, {
          workspaceId,
        });
        const body = await response.json();
        if (!response.ok) throw new Error("Could not load your photos.");
        if (request === generation.current) setPhotos(body.assets);
      } catch {
        if (request === generation.current)
          setError("Could not load Library photos. You can still upload.");
      }
    })();
    return () => {
      generation.current = request + 1;
    };
  }, [workspaceId]);

  const uploadOne = async (file: File): Promise<Photo | null> => {
    if (!PHOTO_TYPES.includes(file.type) || file.size > 20 * 1024 * 1024) {
      toast.error(`${file.name}: choose a JPG, PNG or WebP photo under 20 MB.`);
      return null;
    }
    const params = new URLSearchParams({
      workspaceId,
      requestId: crypto.randomUUID(),
      filename: file.name,
    });
    const response = await authedFetch(`/api/assets/upload?${params}`, {
      method: "POST",
      workspaceId,
      headers: { "Content-Type": file.type },
      body: file,
    });
    const body = await response.json();
    if (!response.ok || !body.asset?.id || !body.asset?.public_url)
      throw new Error("Could not upload the photo.");
    return { id: body.asset.id, filename: file.name, url: body.asset.public_url };
  };

  const upload = async (files: File[]) => {
    if (!files.length || busy || disabled) return;
    const room = single ? 1 : limit - value.length;
    if (room <= 0)
      return void toast.error(
        `This uses up to ${limit} photo${limit === 1 ? "" : "s"}. Remove one first.`,
      );
    if (files.length > room)
      toast.info(`Only the first ${room} photo${room === 1 ? "" : "s"} will be used.`);
    const request = generation.current;
    setBusy(true);
    onBusyChange?.(true);
    try {
      const added: Photo[] = [];
      for (const file of files.slice(0, room)) {
        const photo = await uploadOne(file);
        if (photo) added.push(photo);
      }
      if (request !== generation.current || !added.length) return;
      setPhotos((current) => [
        ...added,
        ...current.filter((p) => !added.some((a) => a.id === p.id)),
      ]);
      onChange(single ? [added[0].id] : [...value, ...added.map((photo) => photo.id)]);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not upload the photo.");
    } finally {
      setBusy(false);
      onBusyChange?.(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : single ? [id] : [...value, id]);

  return (
    <div
      data-no-rhythm
      className={cn(
        "space-y-3 rounded-xl transition-colors",
        // Inside another card (a recap) it drops its own frame.
        bare ? "-m-1.5 p-1.5" : "border bg-surface-3 p-3.5",
        dragging ? "bg-primary-surface ring-1 ring-primary-border" : !bare && "border-border",
      )}
      onDragOver={(event) => {
        if (disabled || busy || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        if (disabled || busy) return;
        event.preventDefault();
        setDragging(false);
        void upload([...event.dataTransfer.files].filter((f) => PHOTO_TYPES.includes(f.type)));
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">
            {note
              ? value.length
                ? `${value.length} of ${limit} · ${note}`
                : note
              : value.length
                ? `${value.length} of ${limit} added`
                : single
                  ? "Optional · one photo"
                  : `Optional · up to ${limit}`}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          disabled={disabled || busy}
          onClick={() => setOpen(!open)}
          className="shrink-0 rounded-full border border-border bg-surface-2 px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50"
        >
          {open ? "Done" : "From Library"}
        </button>
      </div>

      <ul className="flex flex-wrap gap-2">
        {value.map((id, index) => {
          const photo = photos.find((p) => p.id === id);
          return (
            <li
              key={id}
              className="relative size-16 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border"
            >
              {photo ? (
                <img src={photo.url} alt={photo.filename} className="size-full object-cover" />
              ) : (
                <ImageIcon className="m-auto mt-5 size-5 text-muted-foreground" />
              )}
              {value.length > 1 && (
                <span className="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-background/85 text-[10px] font-medium">
                  {index + 1}
                </span>
              )}
              <button
                type="button"
                aria-label={`Remove ${photo?.filename ?? "photo"}`}
                disabled={disabled || busy}
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/85 text-foreground hover:bg-background"
              >
                <X className="size-3" />
              </button>
            </li>
          );
        })}
        {!full && (
          <li>
            <button
              type="button"
              disabled={disabled || busy}
              onClick={() => fileInput.current?.click()}
              className="flex size-16 flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-strong text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50"
            >
              {busy ? <Spinner className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {busy ? "Adding" : value.length && !single ? "Add" : "Upload"}
            </button>
          </li>
        )}
      </ul>
      <input
        ref={fileInput}
        type="file"
        accept={PHOTO_TYPES.join(",")}
        multiple={!single}
        className="hidden"
        onChange={(event) => void upload([...(event.target.files ?? [])])}
      />
      {!value.length && !open && (
        <p className="text-[11px] text-muted-foreground">Drop photos here. Adding them is free.</p>
      )}

      {error && (
        <p role="status" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      {open && (
        <ul className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-lg bg-surface-2 p-2 sm:grid-cols-5">
          {photos.map((photo) => {
            const picked = value.includes(photo.id);
            return (
              <li key={photo.id}>
                <button
                  type="button"
                  aria-label={`Use ${photo.filename}`}
                  aria-pressed={picked}
                  disabled={disabled || busy || (!picked && full)}
                  onClick={() => toggle(photo.id)}
                  className={cn(
                    "relative block aspect-square w-full overflow-hidden rounded-md ring-2 transition disabled:opacity-40",
                    picked ? "ring-primary" : "ring-transparent hover:ring-border-strong",
                  )}
                >
                  <img src={photo.url} alt="" className="size-full object-cover" loading="lazy" />
                  {picked && (
                    <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="size-3" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {!photos.length && (
            <li className="col-span-full py-3 text-center text-xs text-muted-foreground">
              No photos in your Library yet.
            </li>
          )}
        </ul>
      )}

      {/* What to do with them is asked only once there is something to use. */}
      {!hideModes && value.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <FieldLabel>What should Mellox do?</FieldLabel>
          <OptionCards
            label="How to use the photos"
            value={mode}
            onChange={onModeChange}
            options={photoModeOptions(type).map((option) => ({
              ...option,
              icon: MODE_ICON[option.value],
              hint:
                option.value === "preserve" && value.length > 1
                  ? "Keeps the first photo"
                  : option.hint,
            }))}
          />
          {mode === "design" && (
            <SwitchRow
              label="Blend photos into the design"
              hint={
                fidelity === "blend"
                  ? "Faces may change slightly"
                  : "Off: people stay exactly as shot"
              }
              checked={fidelity === "blend"}
              disabled={disabled}
              onCheckedChange={(on) => onFidelityChange(on ? "blend" : "exact")}
            />
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// The brand's own photos and clips, added in the description box itself.
// The box shows what is attached; the footer adds more (device or Library);
// what to do with the photos is asked under the box once there are some.
// Uploads are source material: nothing is made or charged until Generate.
import { useEffect, useRef, useState } from "react";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import {
  Check,
  Image as ImageIcon,
  ImagePlus,
  Lightbulb,
  Palette,
  Pencil,
  Spinner,
  Video,
  X,
  type LucideIcon,
} from "@/components/icons";
import { authedFetch } from "@/lib/authed-fetch";
import type { StudioControls } from "@/lib/studio/jobs";
import { MAX_CLIPS } from "@/lib/studio/clip-edit";
import { isPhotoDesignType, photoLimit, photoModeOptions } from "@/lib/studio/photo-design/mode";
import { getSession, updateSession, type StudioSession } from "@/lib/studio/session-store";
import { FieldLabel, OptionCards, SwitchRow } from "./studio-ui";
import {
  CLIP_TYPES,
  MAX_CLIP_BYTES,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  uploadStudioMedia,
} from "./media-upload";

type Photo = { id: string; filename: string; url: string };
type Mode = NonNullable<StudioControls["referenceMode"]>;

const MODE_ICON: Record<Mode, LucideIcon> = {
  design: Palette,
  preserve: ImageIcon,
  edit: Pencil,
  inspire: Lightbulb,
  hero: Palette,
};

/** What this session can take: photos, clips, and how many photos. */
export function mediaRules(session: StudioSession) {
  const c = session.controls;
  const videoMode = session.type === "video" ? (c.videoMode ?? "generate") : null;
  const recap = videoMode === "recap";
  const mode = c.referenceMode ?? "preserve";
  return {
    photos:
      (["image", "video", "carousel", "story", "ad"].includes(session.type) || !!c.includeImage) &&
      videoMode !== "site",
    clips: session.type === "video" && videoMode !== "site",
    recap,
    videoMode,
    photoLimit: recap
      ? 6
      : isPhotoDesignType(session.type)
        ? photoLimit("design", session.type)
        : photoLimit(mode, session.type),
  };
}

/** Several photos for one picture means designing with them. */
function photoPatch(session: StudioSession, ids: string[]): Partial<StudioControls> {
  const mode = session.controls.referenceMode ?? "preserve";
  return {
    referenceAssetIds: ids,
    referenceMode: !ids.length
      ? undefined
      : ids.length > 1 && mode === "preserve" && isPhotoDesignType(session.type)
        ? "design"
        : mode,
  };
}

export type PromptMediaState = ReturnType<typeof usePromptMedia>;

export function usePromptMedia(session: StudioSession, disabled?: boolean) {
  const c = session.controls;
  const rules = mediaRules(session);
  const [library, setLibrary] = useState<Photo[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [clipNames, setClipNames] = useState<Record<string, { name: string; preview?: string }>>(
    {},
  );
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const previews = useRef<string[]>([]);

  const photoIds = rules.photos ? (c.referenceAssetIds ?? []) : [];
  const clipIds = rules.clips && rules.videoMode === "brand" ? (c.sourceVideoAssetIds ?? []) : [];
  const single = rules.photoLimit === 1;

  useEffect(() => {
    const request = ++generation.current;
    setLibrary([]);
    setLibraryError(null);
    void (async () => {
      try {
        const response = await authedFetch(
          `/api/studio/references?workspaceId=${session.workspaceId}`,
          { workspaceId: session.workspaceId },
        );
        const body = await response.json();
        if (!response.ok) throw new Error();
        if (request === generation.current) setLibrary(body.assets ?? []);
      } catch {
        if (request === generation.current)
          setLibraryError("Could not load Library photos. You can still upload.");
      }
    })();
    return () => {
      generation.current = request + 1;
    };
  }, [session.workspaceId]);

  useEffect(
    () => () => {
      for (const url of previews.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // Uploads finish later: patch the latest controls, and re-quote a video.
  const set = (patch: Partial<StudioControls>) => {
    const latest = getSession(session.id)?.controls ?? session.controls;
    updateSession(session.id, {
      controls: {
        ...latest,
        ...patch,
        ...("referenceAssetIds" in patch ? { videoQuote: undefined } : {}),
      },
    });
  };

  const setBusyBoth = (value: boolean) => {
    setBusy(value);
    updateSession(session.id, { uploadingReference: value });
  };

  const addPhotos = async (files: File[]) => {
    if (!rules.photos) return;
    if (rules.videoMode === "brand" && clipIds.length) {
      toast.error("This video is made from your clips. Remove them to use photos instead.");
      return;
    }
    const room = single ? 1 : rules.photoLimit - photoIds.length;
    if (room <= 0) {
      toast.error(
        `This uses up to ${rules.photoLimit} photo${rules.photoLimit === 1 ? "" : "s"}. Remove one first.`,
      );
      return;
    }
    if (files.length > room)
      toast.info(`Only the first ${room} photo${room === 1 ? "" : "s"} will be used.`);
    const added: Photo[] = [];
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_PHOTO_BYTES) {
        toast.error(`${file.name}: choose a photo under 20 MB.`);
        continue;
      }
      const photo = await uploadStudioMedia(session.workspaceId, file, "photo");
      added.push({ id: photo.id, filename: photo.filename, url: photo.url ?? "" });
    }
    if (!added.length) return;
    setLibrary((current) => [
      ...added,
      ...current.filter((p) => !added.some((a) => a.id === p.id)),
    ]);
    const ids = single ? [added[0].id] : [...photoIds, ...added.map((p) => p.id)];
    set({
      ...photoPatch(session, ids),
      // Photos in a clips video start a plain video from them instead.
      ...(rules.videoMode === "brand" ? { videoMode: "generate" as const } : {}),
    });
  };

  const addClips = async (files: File[]) => {
    if (!rules.clips) return;
    const room = MAX_CLIPS - clipIds.length;
    if (room <= 0) return void toast.error(`Up to ${MAX_CLIPS} clips. Remove one first.`);
    if (files.length > room)
      toast.info(`Only the first ${room} clip${room === 1 ? "" : "s"} will be used.`);
    const added: { id: string; name: string; preview: string }[] = [];
    for (const file of files.slice(0, room)) {
      if (file.size > MAX_CLIP_BYTES) {
        toast.error(`${file.name}: choose a clip under 50 MB.`);
        continue;
      }
      const clip = await uploadStudioMedia(session.workspaceId, file, "clip");
      const preview = URL.createObjectURL(file);
      previews.current.push(preview);
      added.push({ id: clip.id, name: file.name, preview });
    }
    if (!added.length) return;
    setClipNames((current) => ({
      ...current,
      ...Object.fromEntries(added.map((a) => [a.id, { name: a.name, preview: a.preview }])),
    }));
    const hadPhotos = (c.referenceAssetIds ?? []).length > 0 && rules.videoMode !== "brand";
    if (hadPhotos) toast.info("Your photos were set aside: this video is made from your clips.");
    set({
      videoMode: "brand",
      sourceVideoAssetIds: [...clipIds, ...added.map((a) => a.id)],
      ...(rules.videoMode !== "brand" ? { referenceAssetIds: [], referenceMode: undefined } : {}),
    });
  };

  /** Files from the picker or a drop: photos and clips are sorted here. */
  const addFiles = async (files: File[]) => {
    if (!files.length || busy || disabled) return;
    const photos = files.filter((f) => PHOTO_TYPES.includes(f.type));
    const clips = files.filter((f) => CLIP_TYPES.includes(f.type));
    const other = files.length - photos.length - clips.length;
    if (other || (clips.length && !rules.clips) || (photos.length && !rules.photos))
      toast.error(
        rules.clips
          ? "Choose JPG, PNG or WebP photos, or MP4, MOV or WebM clips."
          : "Choose JPG, PNG or WebP photos.",
      );
    setBusyBoth(true);
    try {
      // Clips decide the video, so they go first and photos are not mixed in.
      if (clips.length && rules.clips) await addClips(clips);
      else if (photos.length) await addPhotos(photos);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Could not upload.");
    } finally {
      setBusyBoth(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const togglePhoto = (id: string) => {
    if (rules.videoMode === "brand" && clipIds.length) {
      toast.error("This video is made from your clips. Remove them to use photos instead.");
      return;
    }
    const picked = photoIds.includes(id);
    const ids = picked ? photoIds.filter((v) => v !== id) : single ? [id] : [...photoIds, id];
    set({
      ...photoPatch(session, ids),
      ...(rules.videoMode === "brand" ? { videoMode: "generate" as const } : {}),
    });
  };

  const removePhoto = (id: string) =>
    set(
      photoPatch(
        session,
        photoIds.filter((v) => v !== id),
      ),
    );
  const removeClip = (id: string) => set({ sourceVideoAssetIds: clipIds.filter((v) => v !== id) });

  const accept = [...(rules.photos ? PHOTO_TYPES : []), ...(rules.clips ? CLIP_TYPES : [])];
  const canAdd = accept.length > 0;

  const dropProps = canAdd
    ? {
        onDragOver: (event: React.DragEvent) => {
          if (disabled || busy || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: React.DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        },
        onDrop: (event: React.DragEvent) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          setDragging(false);
          void addFiles([...event.dataTransfer.files]);
        },
      }
    : {};

  return {
    session,
    rules,
    disabled,
    library,
    libraryError,
    libraryOpen,
    setLibraryOpen,
    clipNames,
    photoIds,
    clipIds,
    single,
    busy,
    dragging,
    fileInput,
    accept,
    canAdd,
    addFiles,
    togglePhoto,
    removePhoto,
    removeClip,
    dropProps,
    set,
  };
}

/** What is attached, inside the description box. */
export function MediaStrip({ media }: { media: PromptMediaState }) {
  const { photoIds, clipIds, library, clipNames, busy, disabled } = media;
  if (!photoIds.length && !clipIds.length && !busy) return null;
  return (
    <ul className="flex flex-wrap gap-2 px-3.5 pb-1 pt-1" aria-label="Attached media">
      {photoIds.map((id, index) => {
        const photo = library.find((p) => p.id === id);
        return (
          <li
            key={id}
            className="relative size-14 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border"
          >
            {photo?.url ? (
              <img src={photo.url} alt={photo.filename} className="size-full object-cover" />
            ) : (
              <ImageIcon className="m-auto mt-4 size-5 text-muted-foreground" />
            )}
            {photoIds.length > 1 && (
              <span className="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-background/85 text-[10px] font-medium">
                {index + 1}
              </span>
            )}
            <RemoveButton
              label={`Remove ${photo?.filename ?? "photo"}`}
              disabled={disabled || busy}
              onClick={() => media.removePhoto(id)}
            />
          </li>
        );
      })}
      {clipIds.map((id, index) => {
        const clip = clipNames[id];
        return (
          <li
            key={id}
            title={clip?.name ?? `Clip ${index + 1}`}
            className="relative size-14 overflow-hidden rounded-lg bg-surface-2 ring-1 ring-border"
          >
            {clip?.preview ? (
              <video
                src={clip.preview}
                muted
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
            ) : (
              <span className="grid size-full place-items-center text-[10px] text-muted-foreground">
                Clip {index + 1}
              </span>
            )}
            <span className="absolute bottom-1 left-1 grid size-4 place-items-center rounded-full bg-background/85">
              <Video className="size-2.5" />
            </span>
            <RemoveButton
              label={`Remove ${clip?.name ?? "clip"}`}
              disabled={disabled || busy}
              onClick={() => media.removeClip(id)}
            />
          </li>
        );
      })}
      {busy ? (
        <li className="grid size-14 place-items-center rounded-lg border border-dashed border-border-strong text-muted-foreground">
          <Spinner className="size-4 animate-spin" aria-label="Uploading" />
        </li>
      ) : null}
    </ul>
  );
}

function RemoveButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-background/85 text-foreground hover:bg-background"
    >
      <X className="size-3" />
    </button>
  );
}

/** The footer buttons: add from the device, or pick from the Library. */
export function AttachButtons({ media }: { media: PromptMediaState }) {
  const { rules, canAdd, busy, disabled } = media;
  if (!canAdd) return null;
  const label = rules.clips && rules.photos ? "Photos or clips" : rules.clips ? "Clips" : "Photos";
  return (
    <>
      <button
        type="button"
        onClick={() => media.fileInput.current?.click()}
        disabled={disabled || busy}
        title="Adding them is free"
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3 font-medium text-foreground transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50"
      >
        {busy ? <Spinner className="size-3.5 animate-spin" /> : <ImagePlus className="size-3.5" />}
        {busy ? "Adding…" : label}
      </button>
      {rules.photos ? (
        <button
          type="button"
          aria-expanded={media.libraryOpen}
          onClick={() => media.setLibraryOpen(!media.libraryOpen)}
          disabled={disabled || busy}
          className={cn(
            "inline-flex items-center gap-1 font-medium transition-colors disabled:opacity-50",
            media.libraryOpen ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          From Library
        </button>
      ) : null}
      <input
        ref={media.fileInput}
        type="file"
        accept={media.accept.join(",")}
        multiple={!(media.single && !rules.clips)}
        className="hidden"
        onChange={(event) => void media.addFiles([...(event.target.files ?? [])])}
      />
    </>
  );
}

/** Shown over the box while files are dragged onto it. */
export function DropHint({ media }: { media: PromptMediaState }) {
  if (!media.dragging) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-primary-border bg-primary-surface/90 text-sm font-medium text-foreground">
      Drop to add {media.rules.clips ? "photos or clips" : "photos"}
    </div>
  );
}

/** Library photos to pick from, right under the box. */
export function LibraryPicker({ media }: { media: PromptMediaState }) {
  const { library, libraryError, photoIds, single, rules, busy, disabled } = media;
  if (!media.libraryOpen || !rules.photos) return null;
  const full = !single && photoIds.length >= rules.photoLimit;
  return (
    <div className="mt-2 space-y-2">
      {libraryError ? (
        <p role="status" className="text-xs text-muted-foreground">
          {libraryError}
        </p>
      ) : null}
      <ul className="grid max-h-56 grid-cols-4 gap-2 overflow-y-auto rounded-xl bg-surface-2 p-2 sm:grid-cols-6">
        {library.map((photo) => {
          const picked = photoIds.includes(photo.id);
          return (
            <li key={photo.id}>
              <button
                type="button"
                aria-label={`Use ${photo.filename}`}
                aria-pressed={picked}
                disabled={disabled || busy || (!picked && full)}
                onClick={() => media.togglePhoto(photo.id)}
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
        {!library.length && (
          <li className="col-span-full py-3 text-center text-xs text-muted-foreground">
            No photos in your Library yet.
          </li>
        )}
      </ul>
    </div>
  );
}

/** What Mellox does with the photos, asked only once there are some. */
export function PhotoUse({ media }: { media: PromptMediaState }) {
  const { session, photoIds, rules, disabled, set } = media;
  if (!photoIds.length || rules.recap) return null;
  const c = session.controls;
  const mode = c.referenceMode ?? "preserve";
  const fidelity = c.photoFidelity ?? "exact";
  return (
    <div data-no-rhythm className="space-y-2 rounded-xl border border-border bg-surface-3 p-3.5">
      <FieldLabel>What should Mellox do with your photos?</FieldLabel>
      <OptionCards
        label="How to use the photos"
        value={mode}
        onChange={(referenceMode) =>
          set({
            referenceMode,
            referenceAssetIds: photoIds.slice(0, photoLimit(referenceMode, session.type)),
          })
        }
        options={photoModeOptions(session.type).map((option) => ({
          ...option,
          icon: MODE_ICON[option.value],
          hint:
            option.value === "preserve" && photoIds.length > 1
              ? "Keeps the first photo"
              : option.hint,
        }))}
      />
      {mode === "design" && (
        <SwitchRow
          label="Blend photos into the design"
          hint={
            fidelity === "blend" ? "Faces may change slightly" : "Off: people stay exactly as shot"
          }
          checked={fidelity === "blend"}
          disabled={disabled}
          onCheckedChange={(on) => set({ photoFidelity: on ? "blend" : "exact" })}
        />
      )}
    </div>
  );
}

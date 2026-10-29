"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Upload, X } from "@/components/icons";
import { Segmented } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";
import { photoLimit, photoModeOptions } from "@/lib/studio/photo-design/mode";

type Photo = { id: string; filename: string; url: string };
type Mode = NonNullable<StudioControls["referenceMode"]>;
type Fidelity = NonNullable<StudioControls["photoFidelity"]>;

/** Uploads are source material. Nothing is generated or charged in this picker. */
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
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const limit = fixedLimit ?? photoLimit(mode, type);
  const single = limit === 1;

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
          setError("Could not load Library photos. You can still upload one.");
      }
    })();
    return () => {
      generation.current = request + 1;
    };
  }, [workspaceId]);

  const uploadOne = async (file: File): Promise<Photo | null> => {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
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

  return (
    <section className="space-y-2 rounded-xl border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Your photos <span className="text-muted-foreground">(optional)</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {value.length}/{limit}
        </span>
      </div>
      {!hideModes && (
        <p className="text-xs text-muted-foreground">
          Choose how Mellox uses your photos. Uploading is free.
        </p>
      )}
      {!hideModes && (
        <Segmented
          label="How to use the photos"
          className="max-w-full flex-wrap"
          value={mode}
          onChange={onModeChange}
          options={photoModeOptions(type)}
        />
      )}
      {!hideModes && mode === "design" && (
        <Segmented
          label="Your photos in the design"
          className="max-w-full flex-wrap"
          value={fidelity}
          onChange={onFidelityChange}
          options={[
            { value: "exact", label: "Keep photos exact", hint: "People stay exactly as shot" },
            { value: "blend", label: "Blend it more", hint: "Faces may change slightly" },
          ]}
        />
      )}
      <div className="flex flex-wrap gap-2">
        {value.map((id) => {
          const photo = photos.find((p) => p.id === id);
          return (
            <div
              key={id}
              className="relative size-16 overflow-hidden rounded-lg border border-primary"
            >
              {photo ? (
                <img src={photo.url} alt={photo.filename} className="size-full object-cover" />
              ) : (
                <span className="text-xs">Selected photo</span>
              )}
              <button
                type="button"
                aria-label={`Remove ${photo?.filename ?? "photo"}`}
                disabled={disabled || busy}
                onClick={() => onChange(value.filter((v) => v !== id))}
                className="absolute right-0 top-0 rounded-full bg-background p-1"
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple={!single}
        className="hidden"
        onChange={(event) => void upload([...(event.target.files ?? [])])}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || (!single && value.length >= limit)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-3" />
          {busy ? "Uploading…" : single ? "Upload photo" : "Upload photos"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide Library" : "Choose from Library"}
        </Button>
      </div>
      {error && (
        <p role="status" className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
      {open && (
        <div className="grid max-h-52 grid-cols-4 gap-2 overflow-y-auto">
          {photos.map((photo) => (
            <button
              type="button"
              key={photo.id}
              aria-label={`Use ${photo.filename}`}
              aria-pressed={value.includes(photo.id)}
              disabled={
                disabled || busy || (!single && !value.includes(photo.id) && value.length >= limit)
              }
              onClick={() =>
                onChange(
                  value.includes(photo.id)
                    ? value.filter((id) => id !== photo.id)
                    : single
                      ? [photo.id]
                      : [...value, photo.id],
                )
              }
              className={`aspect-square overflow-hidden rounded-lg border-2 ${value.includes(photo.id) ? "border-primary" : "border-transparent"}`}
            >
              <img
                src={photo.url}
                alt={photo.filename}
                className="size-full object-cover"
                loading="lazy"
              />
            </button>
          ))}
          {!photos.length && (
            <p className="col-span-4 text-xs text-muted-foreground">
              No photos yet. Upload one above.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

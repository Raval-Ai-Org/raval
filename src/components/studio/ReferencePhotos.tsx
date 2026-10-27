"use client";

import { useEffect, useRef, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Upload, X } from "@/components/icons";
import { Segmented } from "./studio-ui";
import type { StudioControls } from "@/lib/studio/jobs";

type Photo = { id: string; filename: string; url: string };

/** Uploads are source material. Nothing is generated or charged in this picker. */
export function ReferencePhotos({
  workspaceId,
  value,
  mode,
  onChange,
  onModeChange,
  disabled,
  onBusyChange,
}: {
  workspaceId: string;
  value: string[];
  mode: NonNullable<StudioControls["referenceMode"]>;
  onChange: (ids: string[]) => void;
  onModeChange: (mode: NonNullable<StudioControls["referenceMode"]>) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

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

  const upload = async (file?: File) => {
    if (!file || busy || disabled) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 20 * 1024 * 1024
    ) {
      toast.error("Choose a JPG, PNG or WebP photo under 20 MB.");
      return;
    }
    const limit = mode === "preserve" ? 1 : 4;
    if (value.length >= limit)
      return void toast.error(
        mode === "preserve"
          ? "Keep original uses one photo. Choose Edit details or Inspiration for more."
          : "Choose up to four reference photos.",
      );
    const request = generation.current;
    setBusy(true);
    onBusyChange?.(true);
    try {
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
      if (request !== generation.current) return;
      const photo = { id: body.asset.id, filename: file.name, url: body.asset.public_url };
      setPhotos((current) => [photo, ...current.filter((p) => p.id !== photo.id)]);
      onChange(mode === "preserve" ? [photo.id] : [...value, photo.id]);
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
          Reference photos <span className="text-muted-foreground">(optional)</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {value.length}/{mode === "preserve" ? 1 : 4}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Decide exactly how Mellox may use your photo. Uploading is free.
      </p>
      <Segmented
        label="How to use the photo"
        className="max-w-full flex-wrap"
        value={mode}
        onChange={onModeChange}
        options={[
          { value: "preserve", label: "Keep original", hint: "No regeneration" },
          { value: "edit", label: "Edit details", hint: "Only requested changes" },
          { value: "inspire", label: "Inspiration", hint: "Create something new" },
        ]}
      />
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
                aria-label={`Remove ${photo?.filename ?? "reference photo"}`}
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
        className="hidden"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || busy || value.length >= (mode === "preserve" ? 1 : 4)}
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-3" />
          {busy ? "Uploading…" : "Upload photo"}
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
                disabled ||
                busy ||
                (!value.includes(photo.id) && value.length >= (mode === "preserve" ? 1 : 4))
              }
              onClick={() =>
                onChange(
                  value.includes(photo.id)
                    ? value.filter((id) => id !== photo.id)
                    : mode === "preserve"
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

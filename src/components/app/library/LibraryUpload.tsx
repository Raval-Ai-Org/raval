"use client";

// Library → Upload: many of the brand's own photos and videos at once, into
// the workspace's assets (free, the `upload` rate tier). Files go four at a
// time; each is checked in the browser first and again by the server. One
// summary at the end, never a toast per file.

import { useRef, useState } from "react";
import { Upload } from "@/components/icons";
import {
  CLIP_TYPES,
  MAX_CLIP_BYTES,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  uploadStudioMedia,
} from "@/components/studio/media-upload";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Files per pick; matches the upload tier with room to spare. */
export const MAX_LIBRARY_FILES = 100;
const PARALLEL = 4;

function problem(file: File): string | null {
  if (PHOTO_TYPES.includes(file.type))
    return file.size > MAX_PHOTO_BYTES ? "photos up to 100 MB" : null;
  if (CLIP_TYPES.includes(file.type))
    return file.size > MAX_CLIP_BYTES ? "videos up to 200 MB" : null;
  return "JPG, PNG, WebP, MP4, MOV or WebM";
}

export function LibraryUpload({
  workspaceId,
  onDone,
  className,
}: {
  workspaceId: string | null;
  /** Reload the Library once something was added. */
  onDone: () => void;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const run = async (picked: File[]) => {
    if (!workspaceId || !picked.length) return;
    const files = picked.slice(0, MAX_LIBRARY_FILES);
    if (picked.length > files.length)
      toast.error(`Add up to ${MAX_LIBRARY_FILES} files at a time.`, {
        description: `The first ${MAX_LIBRARY_FILES} are uploading.`,
      });
    const ok: File[] = [];
    const refused: string[] = [];
    for (const f of files) {
      const why = problem(f);
      if (why) refused.push(`${f.name}: ${why}`);
      else ok.push(f);
    }
    let done = 0;
    let failed = 0;
    setProgress({ done: 0, total: ok.length });
    const queue = [...ok];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          await uploadStudioMedia(workspaceId, f, f.type.startsWith("video/") ? "clip" : "photo");
        } catch {
          failed++;
        }
        done++;
        setProgress({ done, total: ok.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL, ok.length) }, worker));
    setProgress(null);
    const added = ok.length - failed;
    if (added) onDone();
    const notAdded = failed + refused.length;
    if (added && !notAdded) toast.success(`${added} ${added === 1 ? "file" : "files"} added`);
    else if (notAdded)
      toast.error(added ? `${added} added, ${notAdded} not added` : "Nothing was added", {
        description:
          refused.slice(0, 3).join(" · ") ||
          (failed ? "Some files didn't upload. Try them again." : undefined),
      });
  };

  const busy = !!progress;
  return (
    <>
      <input
        ref={input}
        type="file"
        multiple
        accept={[...PHOTO_TYPES, ...CLIP_TYPES].join(",")}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          void run(files);
        }}
      />
      <button
        type="button"
        disabled={!workspaceId || busy}
        onClick={() => input.current?.click()}
        title="Add photos and videos, up to 100 at once"
        className={cn(
          "relative inline-flex h-8 shrink-0 items-center gap-1.5 overflow-hidden rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3 text-[12.5px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-70",
          className,
        )}
      >
        {busy ? (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 [background:var(--mox-gradient)] opacity-35 transition-[width] duration-300"
            style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
          />
        ) : null}
        <Upload className="relative size-3.5" />
        <span className="relative tabular-nums" aria-live="polite">
          {busy ? `Uploading ${progress.done}/${progress.total}` : "Upload"}
        </span>
      </button>
    </>
  );
}

"use client";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { editVisualArtwork } from "@/lib/brand-visuals.functions";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
export function EditVisualText({
  workspaceId,
  jobId,
  headline,
  onChanged,
  disabled,
}: {
  workspaceId: string;
  jobId: string;
  headline: string;
  onChanged: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(headline);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) setText(headline);
      }}
    >
      <PopoverTrigger asChild>
        <button
          className={cn(
            dsFocus,
            "h-8 rounded-full px-3 text-xs font-medium hover:bg-surface-2 disabled:opacity-45",
          )}
          disabled={disabled}
        >
          Edit image text
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(340px,calc(100vw-32px))] space-y-3 rounded-[20px] p-4"
        align="end"
      >
        <label className="text-[13px] font-medium" htmlFor={`image-headline-${jobId}`}>
          Image headline
        </label>
        <textarea
          id={`image-headline-${jobId}`}
          className={cn(dsFocus, "ds-well w-full px-3 py-2 text-[13px]")}
          value={text}
          maxLength={120}
          rows={3}
          onChange={(e) => setText(e.target.value)}
        />
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
        <button
          className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              await editVisualArtwork({ data: { workspaceId, jobId, headline: text } });
              setOpen(false);
              onChanged();
            } catch (e) {
              setError(e instanceof Error ? e.message : "The image could not be edited.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving" : "Save image"}
        </button>
      </PopoverContent>
    </Popover>
  );
}

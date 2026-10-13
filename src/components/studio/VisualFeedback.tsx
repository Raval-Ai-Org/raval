"use client";
import { useState } from "react";
import { Check, Spinner } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { giveVisualFeedback } from "@/lib/brand-visuals.functions";
import { FEEDBACK_REASONS } from "@/lib/brand-visuals/contracts";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
const labels = {
  matches: "Matches my brand",
  "wrong-theme": "Wrong theme",
  "wrong-product": "Wrong product",
  "too-busy": "Too busy",
  typography: "Wrong typography",
  "too-artificial": "Too artificial",
};
export function VisualFeedback({
  workspaceId,
  jobId,
  disabled,
}: {
  workspaceId: string;
  jobId: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof FEEDBACK_REASONS)[number]>("matches");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || busy}
          className={cn(
            dsFocus,
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium text-foreground hover:bg-surface-2 disabled:opacity-45",
          )}
        >
          {saved && <Check className="size-3.5" />}Brand fit
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(340px,calc(100vw-32px))] space-y-3 rounded-[20px] p-4"
        align="end"
      >
        <p className="text-[13px] font-medium">How does this visual feel?</p>
        <p className="text-[12px] text-muted-foreground">
          Your feedback helps improve future visuals for this brand.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {FEEDBACK_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              disabled={busy}
              className={cn(
                dsGhostBtn,
                "h-8 px-3 text-[11px]",
                reason === r && "border-primary/40 bg-primary/10",
              )}
              onClick={() => {
                setReason(r);
                setSaved(false);
                setError("");
              }}
            >
              {labels[r]}
            </button>
          ))}
        </div>
        <textarea
          className={cn(dsFocus, "ds-well w-full px-3 py-2 text-[12px]")}
          aria-label="Visual feedback details"
          placeholder="What would make it closer? (optional)"
          maxLength={600}
          disabled={busy}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
            setError("");
          }}
          rows={2}
        />
        {error && (
          <p role="alert" className="text-[12px] text-destructive">
            {error}
          </p>
        )}
        <button
          type="button"
          className={cn(dsGhostBtn, "h-8 px-3 text-[12px]")}
          disabled={busy}
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await giveVisualFeedback({ data: { workspaceId, jobId, reason, note } });
              setSaved(true);
              setOpen(false);
              toast.success("Feedback saved", {
                description: "We'll use it to improve future visuals for this brand.",
              });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Feedback could not be saved.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Spinner className="size-3.5 animate-spin" />}Save feedback
        </button>
      </PopoverContent>
    </Popover>
  );
}

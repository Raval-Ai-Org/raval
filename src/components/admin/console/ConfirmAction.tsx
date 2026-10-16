"use client";

// ConfirmAction — a change that needs a written reason. One click opens the
// reason box; nothing happens until the admin confirms with at least 10
// characters. The reason is saved in the audit log with the change.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { textareaClass } from "./parts";

export const MIN_REASON = 10;

export function ConfirmAction({
  label,
  confirmLabel,
  description,
  tone = "default",
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel?: string;
  description?: string;
  tone?: "default" | "danger";
  disabled?: boolean;
  /** Resolve to close the box; throw to keep it open (the caller shows the error). */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const ready = reason.trim().length >= MIN_REASON;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={cn(tone === "danger" && "text-destructive hover:text-destructive")}
      >
        {label}
      </Button>
    );
  }

  return (
    <form
      className="w-full max-w-md space-y-2.5"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!ready || busy) return;
        setBusy(true);
        try {
          await onConfirm(reason.trim());
          setOpen(false);
          setReason("");
        } catch {
          // The caller already told the admin what went wrong; keep the box open.
        } finally {
          setBusy(false);
        }
      }}
    >
      {description && <p className="text-[12.5px] text-muted-foreground">{description}</p>}
      <label className="block">
        <span className="sr-only">Reason</span>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={`Why? (at least ${MIN_REASON} characters, saved in the audit log)`}
          maxLength={300}
          className={textareaClass}
          autoFocus
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="submit"
          size="sm"
          disabled={!ready || busy}
          variant={tone === "danger" ? "destructive" : "default"}
        >
          {busy ? "Working…" : (confirmLabel ?? label)}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

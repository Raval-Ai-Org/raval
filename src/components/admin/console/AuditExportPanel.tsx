"use client";

// Audit export — download the rows that match the current filters as a CSV. A
// written reason is required (it is saved in the audit log with the export), a
// fresh second factor may be asked for, and the file holds at most 5,000 rows.
// Without users.pii.read the file has masked emails and no IP addresses.

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
import { AdminApiError, adminApi, errorMessage } from "./api";
import { MfaPanel } from "./MfaPanel";
import { Field, textareaClass } from "./parts";

export type AuditExportFilter = {
  action?: string;
  targetId?: string;
  failedOnly?: boolean;
};

type Result = { filename: string; csv: string; rows: number; truncated: boolean };

function download(result: Result) {
  const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function AuditExportPanel({ filter }: { filter: AuditExportFilter }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [stepUp, setStepUp] = useState(false);

  const run = useMutation({
    mutationFn: () =>
      adminApi<Result>("/api/admin/audit/export", {
        method: "POST",
        body: {
          ...(filter.action ? { action: filter.action } : {}),
          ...(filter.targetId ? { targetId: filter.targetId } : {}),
          ...(filter.failedOnly ? { failedOnly: true } : {}),
          reason: reason.trim(),
        },
      }),
    onSuccess: (result) => {
      download(result);
      toast.success(
        result.truncated
          ? `Exported the newest ${result.rows.toLocaleString()} rows (more matched).`
          : `Exported ${result.rows.toLocaleString()} rows.`,
      );
      setOpen(false);
      setReason("");
      setStepUp(false);
    },
    onError: (error) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(true);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  if (!open) {
    return (
      <div className="mb-4">
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          Export CSV
        </Button>
      </div>
    );
  }

  return (
    <Tile className="mb-4 space-y-3 p-4">
      <h3 className="text-[14px] font-semibold">Export the matching rows</h3>
      {stepUp ? (
        <MfaPanel
          mode="reauth"
          onVerified={() => {
            setStepUp(false);
            run.mutate();
          }}
        />
      ) : (
        <>
          <Field
            label="Reason"
            hint="At least 10 characters. It is saved in the audit log with this export. Up to 5,000 rows, newest first."
          >
            <textarea
              className={textareaClass}
              value={reason}
              maxLength={300}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={reason.trim().length < 10 || run.isPending}
              onClick={() => run.mutate()}
            >
              {run.isPending ? "Preparing…" : "Download"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={run.isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      )}
    </Tile>
  );
}

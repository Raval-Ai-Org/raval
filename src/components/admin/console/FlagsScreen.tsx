"use client";

// Feature flags — switch new features on gradually, for chosen workspaces, or
// for everyone, and end them on a date. Flags are read by code that asks for
// them by key (src/server/platform/flags.server.ts); an environment variable
// named after the key outranks what is set here, and the list says so.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { FLAG_KEY_PATTERN } from "@/lib/flags/evaluate";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminFlag } from "@/lib/admin/types";
import { adminApi, errorMessage, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { ago, fmtDate } from "./format";
import { Chip, Field, TableFrame, fieldClass, rowClass, td, textareaClass, th } from "./parts";

type Draft = {
  key: string;
  isNew: boolean;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  workspaces: string;
  expiresAt: string;
  reason: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const EMPTY: Draft = {
  key: "",
  isNew: true,
  description: "",
  enabled: false,
  rolloutPercent: 100,
  workspaces: "",
  expiresAt: "",
  reason: "",
};

const STATE: Record<
  AdminFlag["state"],
  { label: string; tone: "success" | "primary" | "neutral" | "warning" }
> = {
  on: { label: "On for everyone", tone: "success" },
  partial: { label: "Gradual roll-out", tone: "primary" },
  off: { label: "Off", tone: "neutral" },
  expired: { label: "Ended", tone: "warning" },
};

function parseIds(text: string): string[] {
  return text
    .split(/[\s,]+/)
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);
}

function toDraft(flag: AdminFlag): Draft {
  return {
    key: flag.key,
    isNew: false,
    description: flag.description,
    enabled: flag.enabled,
    rolloutPercent: flag.rolloutPercent,
    workspaces: flag.workspaceIds.join("\n"),
    expiresAt: flag.expiresAt ? flag.expiresAt.slice(0, 10) : "",
    reason: "",
  };
}

export function FlagsScreen() {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const [draft, setDraft] = useState<Draft | null>(null);
  const canManage = me.data ? hasPermission(me.data.permissions, "flags.manage") : false;

  const flags = useQuery({
    queryKey: ["admin", "flags"],
    queryFn: () => adminApi<AdminFlag[]>("/api/admin/flags"),
  });

  const save = useMutation({
    mutationFn: (value: Draft) =>
      adminApi<{ key: string }>("/api/admin/flags", {
        method: "POST",
        body: {
          key: value.key.trim(),
          description: value.description.trim(),
          enabled: value.enabled,
          rolloutPercent: value.rolloutPercent,
          workspaceIds: parseIds(value.workspaces),
          expiresAt: value.expiresAt
            ? new Date(`${value.expiresAt}T23:59:59Z`).toISOString()
            : null,
          reason: value.reason.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Flag saved.");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const ids = draft ? parseIds(draft.workspaces) : [];
  const valid =
    draft !== null &&
    FLAG_KEY_PATTERN.test(draft.key.trim()) &&
    draft.reason.trim().length >= 10 &&
    ids.every((id) => UUID.test(id));

  return (
    <SurfacePage
      title="Feature flags"
      subtitle="Turn new features on gradually, for chosen workspaces, or for everyone"
      actions={
        canManage && !draft ? (
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
            New flag
          </Button>
        ) : undefined
      }
    >
      {draft && (
        <Tile className="mb-5 space-y-4 p-4">
          <h3 className="text-[14px] font-semibold">{draft.isNew ? "New flag" : draft.key}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {draft.isNew && (
              <Field
                label="Key"
                hint="Lowercase letters, numbers, . - _ — the code asks for this name"
              >
                <input
                  className={fieldClass}
                  value={draft.key}
                  onChange={(event) => set({ key: event.target.value })}
                  placeholder="new-editor"
                  spellCheck={false}
                />
              </Field>
            )}
            <Field label="Description">
              <input
                className={fieldClass}
                value={draft.description}
                maxLength={300}
                onChange={(event) => set({ description: event.target.value })}
              />
            </Field>
            <Field label={`Roll-out: ${draft.rolloutPercent}% of workspaces`}>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft.rolloutPercent}
                onChange={(event) => set({ rolloutPercent: Number(event.target.value) })}
                className="w-full accent-primary"
              />
            </Field>
            <Field label="Ends on (optional)" hint="After this day the flag is off for everyone">
              <input
                type="date"
                className={fieldClass}
                value={draft.expiresAt}
                onChange={(event) => set({ expiresAt: event.target.value })}
              />
            </Field>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => set({ enabled: event.target.checked })}
              className="accent-primary"
            />
            Enabled (uses the roll-out percentage above)
          </label>
          <Field
            label="Always on for these workspaces"
            hint={
              ids.some((id) => !UUID.test(id))
                ? "Every entry must be a workspace id (UUID)."
                : "Workspace ids, one per line. They get the feature even when the flag is off."
            }
          >
            <textarea
              className={textareaClass}
              value={draft.workspaces}
              onChange={(event) => set({ workspaces: event.target.value })}
              spellCheck={false}
            />
          </Field>
          <Field label="Reason" hint="At least 10 characters, saved in the audit log">
            <textarea
              className={textareaClass}
              value={draft.reason}
              maxLength={300}
              onChange={(event) => set({ reason: event.target.value })}
            />
          </Field>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={!valid || save.isPending}
              onClick={() => save.mutate(draft)}
            >
              {save.isPending ? "Saving…" : "Save flag"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </Tile>
      )}

      {flags.isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {flags.error && <LoadError error={flags.error} onRetry={() => void flags.refetch()} />}
      {flags.data && flags.data.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No flags yet.</p>
      )}
      {flags.data && flags.data.length > 0 && (
        <TableFrame label="Feature flags">
          <thead>
            <tr>
              <th className={th}>Flag</th>
              <th className={th}>State</th>
              <th className={th}>Roll-out</th>
              <th className={th}>Ends</th>
              <th className={th}>Changed</th>
              {canManage && <th className={th} />}
            </tr>
          </thead>
          <tbody>
            {flags.data.map((flag) => (
              <tr key={flag.key} className={rowClass}>
                <td className={td}>
                  <span className="font-medium">{flag.key}</span>
                  {flag.description && (
                    <span className="block text-[12px] text-muted-foreground">
                      {flag.description}
                    </span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip tone={STATE[flag.state].tone}>{STATE[flag.state].label}</Chip>
                    {flag.envOverride && (
                      <Chip tone="warning">Environment forces {flag.envOverride}</Chip>
                    )}
                  </div>
                </td>
                <td className={td}>
                  {flag.rolloutPercent}%
                  {flag.workspaceIds.length > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {flag.workspaceIds.length} always on
                    </span>
                  )}
                </td>
                <td className={td}>{flag.expiresAt ? fmtDate(flag.expiresAt) : "—"}</td>
                <td className={td}>{ago(flag.updatedAt)}</td>
                {canManage && (
                  <td className={`${td} text-right`}>
                    <Button size="sm" variant="ghost" onClick={() => setDraft(toDraft(flag))}>
                      Edit
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </SurfacePage>
  );
}

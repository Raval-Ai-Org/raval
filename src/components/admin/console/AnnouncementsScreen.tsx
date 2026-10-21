"use client";

// Announcements — a short message shown at the top of the app to every signed-in
// person, between two dates. Saving is audited; ending one is a save with
// "shown" turned off, so the history stays.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import type { AdminAnnouncement } from "@/lib/admin/types";
import { adminApi, errorMessage } from "./api";
import { LoadError } from "./LoadError";
import { fmtDateTime } from "./format";
import { Chip, Field, fieldClass, textareaClass } from "./parts";

type Draft = {
  id?: string;
  title: string;
  body: string;
  tone: AdminAnnouncement["tone"];
  linkUrl: string;
  dismissible: boolean;
  active: boolean;
  startsAt: string;
  endsAt: string;
  reason: string;
};

const EMPTY: Draft = {
  title: "",
  body: "",
  tone: "info",
  linkUrl: "",
  dismissible: true,
  active: true,
  startsAt: "",
  endsAt: "",
  reason: "",
};

const STATUS: Record<
  AdminAnnouncement["status"],
  { label: string; tone: "success" | "primary" | "neutral" }
> = {
  live: { label: "Live", tone: "success" },
  scheduled: { label: "Scheduled", tone: "primary" },
  ended: { label: "Ended", tone: "neutral" },
  off: { label: "Hidden", tone: "neutral" },
};

/** `<input type=datetime-local>` works in local time; the server wants an ISO instant. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

export function AnnouncementsScreen() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);

  const list = useQuery({
    queryKey: ["admin", "announcements"],
    queryFn: () => adminApi<AdminAnnouncement[]>("/api/admin/announcements"),
  });

  const save = useMutation({
    mutationFn: (value: Draft) =>
      adminApi<{ id: string }>("/api/admin/announcements", {
        method: "POST",
        body: {
          ...(value.id ? { id: value.id } : {}),
          title: value.title.trim(),
          body: value.body.trim(),
          tone: value.tone,
          linkUrl: value.linkUrl.trim() || null,
          dismissible: value.dismissible,
          active: value.active,
          startsAt: toIso(value.startsAt),
          endsAt: toIso(value.endsAt),
          reason: value.reason.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Announcement saved.");
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "announcements"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const windowOk =
    !draft ||
    !draft.startsAt ||
    !draft.endsAt ||
    new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime();
  const linkOk = !draft || !draft.linkUrl.trim() || /^https:\/\/\S+$/.test(draft.linkUrl.trim());
  const valid =
    draft !== null &&
    draft.title.trim().length > 0 &&
    draft.reason.trim().length >= 10 &&
    windowOk &&
    linkOk;

  return (
    <SurfacePage
      title="Announcements"
      subtitle="Messages shown at the top of the app to everyone who is signed in"
      actions={
        !draft ? (
          <Button size="sm" onClick={() => setDraft({ ...EMPTY })}>
            New announcement
          </Button>
        ) : undefined
      }
    >
      {draft && (
        <Tile className="mb-5 space-y-4 p-4">
          <h3 className="text-[14px] font-semibold">
            {draft.id ? "Edit announcement" : "New announcement"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title">
              <input
                className={fieldClass}
                value={draft.title}
                maxLength={120}
                onChange={(event) => set({ title: event.target.value })}
              />
            </Field>
            <Field label="Style">
              <select
                className={fieldClass}
                value={draft.tone}
                onChange={(event) => set({ tone: event.target.value as Draft["tone"] })}
              >
                <option value="info">Information</option>
                <option value="success">Good news</option>
                <option value="warning">Heads-up</option>
              </select>
            </Field>
            <Field label="Starts (optional)" hint="Blank means right away">
              <input
                type="datetime-local"
                className={fieldClass}
                value={draft.startsAt}
                onChange={(event) => set({ startsAt: event.target.value })}
              />
            </Field>
            <Field
              label="Ends (optional)"
              hint={windowOk ? "Blank means until you hide it" : "Must be after the start."}
            >
              <input
                type="datetime-local"
                className={fieldClass}
                value={draft.endsAt}
                onChange={(event) => set({ endsAt: event.target.value })}
              />
            </Field>
          </div>
          <Field label="Message (optional)">
            <textarea
              className={textareaClass}
              value={draft.body}
              maxLength={600}
              onChange={(event) => set({ body: event.target.value })}
            />
          </Field>
          <Field
            label="Link (optional)"
            hint={linkOk ? "Must start with https://" : "Use a full https:// address."}
          >
            <input
              className={fieldClass}
              value={draft.linkUrl}
              onChange={(event) => set({ linkUrl: event.target.value })}
              placeholder="https://"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap gap-5 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(event) => set({ active: event.target.checked })}
                className="accent-primary"
              />
              Shown
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.dismissible}
                onChange={(event) => set({ dismissible: event.target.checked })}
                className="accent-primary"
              />
              People can close it
            </label>
          </div>
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
              {save.isPending ? "Saving…" : "Save"}
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

      {list.isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {list.error && <LoadError error={list.error} onRetry={() => void list.refetch()} />}
      {list.data && list.data.length === 0 && (
        <p className="text-[13px] text-muted-foreground">No announcements yet.</p>
      )}
      <div className="space-y-3">
        {list.data?.map((item) => (
          <Tile key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-semibold">{item.title}</h3>
                <Chip tone={STATUS[item.status].tone}>{STATUS[item.status].label}</Chip>
              </div>
              {item.body && <p className="text-[13px] text-muted-foreground">{item.body}</p>}
              <p className="text-[12px] text-muted-foreground">
                {fmtDateTime(item.startsAt)} →{" "}
                {item.endsAt ? fmtDateTime(item.endsAt) : "until hidden"}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                setDraft({
                  id: item.id,
                  title: item.title,
                  body: item.body,
                  tone: item.tone,
                  linkUrl: item.linkUrl ?? "",
                  dismissible: item.dismissible,
                  active: item.active,
                  startsAt: toLocalInput(item.startsAt),
                  endsAt: toLocalInput(item.endsAt),
                  reason: "",
                })
              }
            >
              Edit
            </Button>
          </Tile>
        ))}
      </div>
    </SurfacePage>
  );
}

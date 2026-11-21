"use client";

// Trend Radar (ADR-0052) — staff post a moment (a launch, a holiday, a meme
// that took off) with a brief, pictures, clips and links, pick who it is for,
// and publish. Every brand it reaches sees it in Studio's ideas, Surprise me,
// the director, Campaigns and Autopilot, made in that brand's own style.
// Saving is audited; ending one is a save with status "archived".

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { authedFetch } from "@/lib/authed-fetch";
import type { AdminTrend } from "@/lib/admin/types";
import { INDUSTRIES } from "@/lib/studio/knowledge/industries";
import { adminApi, errorMessage } from "./api";
import { LoadError } from "./LoadError";
import { fmtDateTime } from "./format";
import { Chip, Field, fieldClass, textareaClass } from "./parts";

type Media = AdminTrend["media"][number];

type Draft = {
  id?: string;
  /** Groups uploads before the first save; the trend's id once it has one. */
  key: string;
  title: string;
  brief: string;
  whatToMake: string;
  doNots: string;
  scope: AdminTrend["scope"];
  industries: string[];
  workspaceIds: string;
  languages: string;
  platforms: string[];
  tags: string;
  links: string;
  media: Media[];
  allowMood: boolean;
  priority: number;
  startsAt: string;
  endsAt: string;
  reason: string;
};

const newKey = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000";

const empty = (): Draft => ({
  key: newKey(),
  title: "",
  brief: "",
  whatToMake: "",
  doNots: "",
  scope: "all",
  industries: [],
  workspaceIds: "",
  languages: "",
  platforms: [],
  tags: "",
  links: "",
  media: [],
  allowMood: false,
  priority: 3,
  startsAt: "",
  endsAt: "",
  reason: "",
});

const STATE: Record<
  AdminTrend["state"],
  { label: string; tone: "success" | "primary" | "neutral" | "warning" }
> = {
  live: { label: "Live", tone: "success" },
  scheduled: { label: "Scheduled", tone: "primary" },
  draft: { label: "Draft", tone: "warning" },
  ended: { label: "Ended", tone: "neutral" },
  archived: { label: "Ended", tone: "neutral" },
};

const SCOPES: { id: AdminTrend["scope"]; label: string; hint: string }[] = [
  { id: "all", label: "All brands", hint: "Every brand sees it (a big cultural moment)." },
  {
    id: "specific",
    label: "Specific",
    hint: "Only the industries or brands you pick below.",
  },
  {
    id: "micro",
    label: "Micro / rare",
    hint: "A niche moment: only brands in the picked industries.",
  },
];

const PLATFORMS = ["instagram", "facebook", "linkedin", "tiktok", "x", "threads", "youtube"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const list = (text: string) =>
  text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);

const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const toIso = (local: string) => (local ? new Date(local).toISOString() : null);

function fromTrend(item: AdminTrend): Draft {
  return {
    id: item.id,
    key: item.id,
    title: item.title,
    brief: item.brief,
    whatToMake: item.whatToMake,
    doNots: item.doNots,
    scope: item.scope,
    industries: item.industries,
    workspaceIds: item.workspaceIds.join("\n"),
    languages: item.languages.join(", "),
    platforms: item.platforms,
    tags: item.tags.join(", "),
    links: item.links.join("\n"),
    media: item.media,
    allowMood: item.allowMood,
    priority: item.priority,
    startsAt: toLocalInput(item.startsAt),
    endsAt: toLocalInput(item.endsAt),
    reason: "",
  };
}

async function uploadMedia(key: string, file: File): Promise<Media> {
  const form = new FormData();
  form.set("file", file);
  form.set("key", key);
  const response = await authedFetch("/api/admin/trends/media", {
    method: "POST",
    body: form,
    workspaceId: null,
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? "Upload failed."));
  return payload as unknown as Media;
}

export function TrendsScreen() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [uploading, setUploading] = useState(0);

  const trends = useQuery({
    queryKey: ["admin", "trends"],
    queryFn: () => adminApi<AdminTrend[]>("/api/admin/trends"),
  });

  const save = useMutation({
    mutationFn: ({ value, status }: { value: Draft; status: AdminTrend["status"] }) =>
      adminApi<{ id: string }>("/api/admin/trends", {
        method: "POST",
        body: {
          ...(value.id ? { id: value.id } : {}),
          title: value.title.trim(),
          brief: value.brief.trim(),
          whatToMake: value.whatToMake.trim(),
          doNots: value.doNots.trim(),
          scope: value.scope,
          industries: value.scope === "all" ? [] : value.industries,
          workspaceIds: value.scope === "all" ? [] : list(value.workspaceIds),
          languages: list(value.languages),
          platforms: value.platforms,
          tags: list(value.tags),
          links: list(value.links),
          media: value.media.map(({ path, kind, caption }) => ({ path, kind, caption })),
          allowMood: value.allowMood,
          priority: value.priority,
          status,
          startsAt: toIso(value.startsAt),
          endsAt: toIso(value.endsAt),
          reason: value.reason.trim(),
        },
      }),
    onSuccess: (_, { status }) => {
      toast.success(
        status === "live"
          ? "Trend published. Matching brands see it within a minute."
          : status === "archived"
            ? "Trend ended."
            : "Draft saved.",
      );
      setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "trends"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const set = (patch: Partial<Draft>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  const addFiles = async (files: FileList | null) => {
    if (!draft || !files?.length) return;
    const key = draft.key;
    const picked = Array.from(files).slice(0, Math.max(0, 12 - draft.media.length));
    setUploading((n) => n + picked.length);
    for (const file of picked) {
      try {
        const media = await uploadMedia(key, file);
        setDraft((current) =>
          current && current.key === key
            ? { ...current, media: [...current.media, media].slice(0, 12) }
            : current,
        );
      } catch (error) {
        toast.error(`${file.name}: ${errorMessage(error)}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };

  const windowOk =
    !draft ||
    !draft.startsAt ||
    !draft.endsAt ||
    new Date(draft.endsAt).getTime() > new Date(draft.startsAt).getTime();
  const badLinks = draft ? list(draft.links).filter((link) => !/^https:\/\/\S+$/.test(link)) : [];
  const badIds = draft ? list(draft.workspaceIds).filter((id) => !UUID.test(id)) : [];
  const aimed =
    !draft ||
    draft.scope === "all" ||
    draft.industries.length > 0 ||
    list(draft.workspaceIds).length > 0;
  const valid =
    draft !== null &&
    draft.title.trim().length >= 2 &&
    draft.reason.trim().length >= 10 &&
    windowOk &&
    badLinks.length === 0 &&
    badIds.length === 0 &&
    uploading === 0;
  const canPublish = valid && aimed && !!draft && draft.brief.trim().length > 0;

  return (
    <SurfacePage
      title="Trend Radar"
      subtitle="Post a moment once; every brand it fits gets ideas and posts about it in its own style"
      actions={
        !draft ? (
          <Button size="sm" onClick={() => setDraft(empty())}>
            New trend
          </Button>
        ) : undefined
      }
    >
      {draft && (
        <Tile className="mb-5 space-y-4 p-4">
          <h3 className="text-[14px] font-semibold">{draft.id ? "Edit trend" : "New trend"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" hint="What people call it, e.g. “GTA 6 launch”">
              <input
                className={fieldClass}
                value={draft.title}
                maxLength={120}
                onChange={(event) => set({ title: event.target.value })}
              />
            </Field>
            <Field
              label="Words a brief may use to name it"
              hint="Comma separated, e.g. gta 6, gta vi"
            >
              <input
                className={fieldClass}
                value={draft.tags}
                onChange={(event) => set({ tags: event.target.value })}
              />
            </Field>
          </div>
          <Field label="What is happening" hint="The facts: what, when, why people care">
            <textarea
              className={textareaClass}
              value={draft.brief}
              maxLength={2000}
              onChange={(event) => set({ brief: event.target.value })}
            />
          </Field>
          <Field
            label="What to make"
            hint="Angles and formats that work, e.g. “a loading screen of the brand's own world”"
          >
            <textarea
              className={textareaClass}
              value={draft.whatToMake}
              maxLength={1200}
              onChange={(event) => set({ whatToMake: event.target.value })}
            />
          </Field>
          <Field label="Don'ts" hint="What brands must avoid (owner's logos, spoilers, tone)">
            <textarea
              className={textareaClass}
              value={draft.doNots}
              maxLength={800}
              onChange={(event) => set({ doNots: event.target.value })}
            />
          </Field>

          <div className="space-y-2">
            <span className="text-[12.5px] font-medium text-foreground/80">Who it is for</span>
            <div className="flex flex-wrap gap-2">
              {SCOPES.map((scope) => (
                <Button
                  key={scope.id}
                  size="sm"
                  variant={draft.scope === scope.id ? "default" : "outline"}
                  onClick={() => set({ scope: scope.id })}
                >
                  {scope.label}
                </Button>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">
              {SCOPES.find((scope) => scope.id === draft.scope)?.hint}
            </p>
          </div>
          {draft.scope !== "all" && (
            <>
              <div className="space-y-2">
                <span className="text-[12.5px] font-medium text-foreground/80">Industries</span>
                <div className="flex flex-wrap gap-1.5">
                  {INDUSTRIES.map((industry) => {
                    const on = draft.industries.includes(industry.id);
                    return (
                      <button
                        key={industry.id}
                        type="button"
                        onClick={() =>
                          set({
                            industries: on
                              ? draft.industries.filter((id) => id !== industry.id)
                              : [...draft.industries, industry.id],
                          })
                        }
                        className={
                          on
                            ? "rounded-full bg-primary px-3 py-1 text-[12px] font-medium text-primary-foreground"
                            : "rounded-full bg-foreground/[0.06] px-3 py-1 text-[12px] text-foreground/75 hover:bg-foreground/[0.1]"
                        }
                      >
                        {industry.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <Field
                label="Specific brands (optional)"
                hint={
                  badIds.length
                    ? `Not a workspace id: ${badIds[0]}`
                    : "Workspace ids, one per line. They never see who else it went to."
                }
              >
                <textarea
                  className={textareaClass}
                  value={draft.workspaceIds}
                  onChange={(event) => set({ workspaceIds: event.target.value })}
                  spellCheck={false}
                />
              </Field>
            </>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Languages (optional)"
              hint="Blank means every language, e.g. English, Urdu"
            >
              <input
                className={fieldClass}
                value={draft.languages}
                onChange={(event) => set({ languages: event.target.value })}
              />
            </Field>
            <Field label="Importance" hint="5 shows it first in ideas">
              <select
                className={fieldClass}
                value={draft.priority}
                onChange={(event) => set({ priority: Number(event.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Starts (optional)" hint="Blank means when you publish">
              <input
                type="datetime-local"
                className={fieldClass}
                value={draft.startsAt}
                onChange={(event) => set({ startsAt: event.target.value })}
              />
            </Field>
            <Field
              label="Ends (optional)"
              hint={windowOk ? "Blank means until you end it" : "Must be after the start."}
            >
              <input
                type="datetime-local"
                className={fieldClass}
                value={draft.endsAt}
                onChange={(event) => set({ endsAt: event.target.value })}
              />
            </Field>
          </div>

          <div className="space-y-2">
            <span className="text-[12.5px] font-medium text-foreground/80">
              Platforms (optional, blank means all)
            </span>
            <div className="flex flex-wrap gap-1.5">
              {PLATFORMS.map((platform) => {
                const on = draft.platforms.includes(platform);
                return (
                  <button
                    key={platform}
                    type="button"
                    onClick={() =>
                      set({
                        platforms: on
                          ? draft.platforms.filter((p) => p !== platform)
                          : [...draft.platforms, platform],
                      })
                    }
                    className={
                      on
                        ? "rounded-full bg-primary px-3 py-1 text-[12px] font-medium capitalize text-primary-foreground"
                        : "rounded-full bg-foreground/[0.06] px-3 py-1 text-[12px] capitalize text-foreground/75 hover:bg-foreground/[0.1]"
                    }
                  >
                    {platform}
                  </button>
                );
              })}
            </div>
          </div>

          <Field
            label="Links (optional)"
            hint={
              badLinks.length
                ? `Use a full https:// address: ${badLinks[0]}`
                : "One per line, https:// only"
            }
          >
            <textarea
              className={textareaClass}
              value={draft.links}
              onChange={(event) => set({ links: event.target.value })}
              spellCheck={false}
            />
          </Field>

          <div className="space-y-2">
            <span className="text-[12.5px] font-medium text-foreground/80">
              Pictures and clips ({draft.media.length}/12)
            </span>
            <div className="flex flex-wrap gap-2">
              {draft.media.map((media) => (
                <div
                  key={media.path}
                  className="relative h-24 w-24 overflow-hidden rounded-xl bg-foreground/[0.05]"
                >
                  {media.url && media.kind === "image" ? (
                    <img src={media.url} alt="" className="h-full w-full object-contain" />
                  ) : media.url ? (
                    <video src={media.url} className="h-full w-full object-contain" muted />
                  ) : (
                    <span className="grid h-full place-items-center text-[11px] text-muted-foreground">
                      {media.kind}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label="Remove"
                    className="absolute right-1 top-1 rounded-full bg-background/90 px-1.5 text-[11px]"
                    onClick={() => set({ media: draft.media.filter((m) => m.path !== media.path) })}
                  >
                    ×
                  </button>
                </div>
              ))}
              {draft.media.length < 12 && (
                <label className="grid h-24 w-24 cursor-pointer place-items-center rounded-xl border border-dashed border-foreground/20 text-center text-[12px] text-muted-foreground hover:bg-foreground/[0.03]">
                  {uploading ? "Uploading…" : "Add files"}
                  <input
                    type="file"
                    multiple
                    accept="image/*,video/mp4,video/quicktime,video/webm"
                    className="sr-only"
                    onChange={(event) => {
                      void addFiles(event.target.files);
                      event.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={draft.allowMood}
                onChange={(event) => set({ allowMood: event.target.checked })}
                className="accent-primary"
              />
              The writer may look at these pictures for mood (never copied into a post)
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
          {!aimed && (
            <p className="text-[12px] text-warning">
              Pick at least one industry or brand before publishing.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!canPublish || save.isPending}
              onClick={() => save.mutate({ value: draft, status: "live" })}
            >
              {save.isPending ? "Saving…" : "Publish to brands"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!valid || save.isPending}
              onClick={() => save.mutate({ value: draft, status: "draft" })}
            >
              Save draft
            </Button>
            {draft.id && (
              <Button
                size="sm"
                variant="outline"
                disabled={!valid || save.isPending}
                onClick={() => save.mutate({ value: draft, status: "archived" })}
              >
                End it
              </Button>
            )}
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

      {trends.isLoading && <Skeleton className="h-40 rounded-2xl" />}
      {trends.error && <LoadError error={trends.error} onRetry={() => void trends.refetch()} />}
      {trends.data && trends.data.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          No trends yet. Post the next big moment and every brand it fits can use it.
        </p>
      )}
      <div className="space-y-3">
        {trends.data?.map((item) => (
          <Tile key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[14px] font-semibold">{item.title}</h3>
                <Chip tone={STATE[item.state].tone}>{STATE[item.state].label}</Chip>
                <Chip>
                  {item.scope === "all"
                    ? "All brands"
                    : `${item.scope === "micro" ? "Micro" : "Specific"} · ${
                        item.industries.length + item.workspaceIds.length
                      } targets`}
                </Chip>
                {item.media.length > 0 && <Chip>{item.media.length} files</Chip>}
              </div>
              {item.brief && (
                <p className="line-clamp-2 text-[13px] text-muted-foreground">{item.brief}</p>
              )}
              <p className="text-[12px] text-muted-foreground">
                {fmtDateTime(item.startsAt)} →{" "}
                {item.endsAt ? fmtDateTime(item.endsAt) : "until ended"}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => setDraft(fromTrend(item))}>
              Edit
            </Button>
          </Tile>
        ))}
      </div>
    </SurfacePage>
  );
}

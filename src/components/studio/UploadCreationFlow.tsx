"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Button } from "@/components/ui/button";
import {
  Upload,
  Image as ImageIcon,
  Video,
  MessageSquare,
  Sparkles,
  Send,
  CalendarClock,
  Spinner,
} from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { supabase } from "@/integrations/supabase/client";
import { createContentItem, updateContentItem } from "@/lib/content.functions";
import { authedFetch } from "@/lib/authed-fetch";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { workspaceStoragePrefix } from "@/lib/workspace/storage-path";
import { publishContentItems, scheduleContentItems } from "@/lib/sdr.functions";
import { StudioPublishFlow } from "./StudioPublishFlow";

type UploadKind = "photo" | "video" | "text";
type CopyMode = "write" | "generate" | "both";

const CHANNELS: PlatformId[] = [
  "instagram",
  "facebook",
  "linkedin",
  "twitter",
  "threads",
  "tiktok",
  "youtube",
];
const ACCEPT: Record<Exclude<UploadKind, "text">, string> = {
  photo: "image/jpeg,image/png,image/webp",
  video: "video/mp4,video/quicktime,video/webm",
};
const MAX_BYTES: Record<Exclude<UploadKind, "text">, number> = {
  photo: 20 * 1024 * 1024,
  video: 50 * 1024 * 1024,
};
const FIELD =
  "w-full rounded-xl border border-border bg-surface-2/50 px-3 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-primary";

function available(kind: UploadKind, platform: PlatformId) {
  if (kind === "video") return true;
  if (kind === "photo") return platform !== "tiktok" && platform !== "youtube";
  return !["instagram", "tiktok", "youtube"].includes(platform);
}

export function UploadCreationFlow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const workspaceId = useOptionalWorkspaceId();
  const [kind, setKind] = useState<UploadKind | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [direction, setDirection] = useState("");
  const [copyMode, setCopyMode] = useState<CopyMode>("write");
  const [platforms, setPlatforms] = useState<PlatformId[]>([]);
  const [captions, setCaptions] = useState<Partial<Record<PlatformId, string>>>({});
  const [busy, setBusy] = useState<"generate" | "save" | null>(null);
  const [saved, setSaved] = useState<Partial<Record<PlatformId, string>>>({});
  const [groupId] = useState(() => crypto.randomUUID());
  const [storedPath, setStoredPath] = useState<string | null>(null);
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<"publish" | "schedule" | null>(null);
  const [scheduleAt, setScheduleAt] = useState("");
  const selected = useMemo(
    () => platforms.filter((p) => available(kind ?? "text", p)),
    [kind, platforms],
  );
  const destinations = selected.flatMap((platform) =>
    saved[platform] ? [{ id: saved[platform], platform }] : [],
  );

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const pickKind = (next: UploadKind) => {
    if (next === kind) return;
    setKind(next);
    setFile(null);
    setPlatforms((current) => current.filter((platform) => available(next, platform)));
    setStoredPath(null);
    setStoredUrl(null);
  };

  const chooseFile = (next: File | undefined) => {
    if (!next || !kind || kind === "text") return;
    if (!ACCEPT[kind].split(",").includes(next.type))
      return void toast.error("Choose a supported image or video file.");
    if (next.size > MAX_BYTES[kind])
      return void toast.error(
        `${kind === "photo" ? "Photos" : "Videos"} must be under ${MAX_BYTES[kind] / 1024 / 1024} MB.`,
      );
    setFile(next);
    setStoredPath(null);
    setStoredUrl(null);
  };

  const generate = async () => {
    if (!workspaceId || !kind || !selected.length || busy) return;
    if (!title.trim() && !description.trim() && !direction.trim())
      return void toast.error(
        "Add a title, description or direction so the captions have something to say.",
      );
    setBusy("generate");
    try {
      const response = await authedFetch("/api/studio/upload-captions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          workspaceId,
          mediaKind: kind,
          title,
          description,
          direction,
          platforms: selected,
          existing: captions,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(
          typeof result.error === "string"
            ? result.error
            : (result.error?.message ?? "Could not write captions."),
        );
      setCaptions((current) => ({
        ...current,
        ...Object.fromEntries(
          result.captions.map((item: { platform: PlatformId; text: string }) => [
            item.platform,
            item.text,
          ]),
        ),
      }));
      toast.success("Captions ready to edit");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not write captions.");
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!workspaceId || !kind || busy) return false;
    if (!selected.length) {
      toast.error("Choose at least one social channel.");
      return false;
    }
    if (kind !== "text" && !file && !storedPath) {
      toast.error("Add a photo or video first.");
      return false;
    }
    if (selected.some((platform) => !captions[platform]?.trim())) {
      toast.error("Add a caption for every selected channel.");
      return false;
    }
    setBusy("save");
    try {
      let path = storedPath;
      let url = storedUrl;
      if (kind !== "text" && file && !path) {
        const extension =
          file.name.split(".").pop()?.toLowerCase() ?? (kind === "photo" ? "jpg" : "mp4");
        path = `${workspaceStoragePrefix(workspaceId)}uploads/${crypto.randomUUID()}.${extension}`;
        const uploaded = await supabase.storage
          .from("generated-assets")
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploaded.error) throw uploaded.error;
        const signed = await supabase.storage.from("generated-assets").createSignedUrl(path, 3600);
        if (signed.error || !signed.data?.signedUrl)
          throw signed.error ?? new Error("Could not preview uploaded media.");
        url = signed.data.signedUrl;
        setStoredPath(path);
        setStoredUrl(url);
      }
      const next = { ...saved };
      for (const platform of selected) {
        const body = captions[platform]!.trim();
        const meta = {
          studio_type: kind === "video" ? "video" : kind === "photo" ? "image" : "social",
          platform,
          group_id: groupId,
          upload_source: true,
          upload_kind: kind,
          upload_description: description.trim(),
          asset_storage_path: path,
          media_type: path ? (kind === "video" ? "video" : "image") : null,
        };
        if (next[platform]) {
          await updateContentItem({
            data: {
              id: next[platform],
              patch: {
                kind: kind === "video" ? "video" : kind === "photo" ? "image" : "post",
                title: title.trim() || file?.name || "Untitled post",
                body,
                media_url: url,
                meta,
              },
            },
          });
        } else {
          const item = await createContentItem({
            data: {
              workspaceId,
              agent: "echo",
              kind: kind === "video" ? "video" : kind === "photo" ? "image" : "post",
              channel: platform === "twitter" ? "x" : platform,
              title: title.trim() || file?.name || "Untitled post",
              body,
              media_url: url,
              status: "draft",
              meta,
            },
          });
          next[platform] = item.id;
          setSaved({ ...next });
        }
      }
      if (path && file) {
        const { error: assetError } = await supabase.from("assets").upsert(
          {
            workspace_id: workspaceId,
            content_item_id: next[selected[0]],
            generation_id: `upload:${groupId}`,
            idempotency_key: `upload:${groupId}`,
            asset_type: kind === "video" ? "video" : "image",
            status: "ready",
            storage_path: path,
            filename: file.name,
            mime_type: file.type,
            metadata: { studio_type: kind === "video" ? "video" : "image", source: "upload" },
          },
          { onConflict: "workspace_id,idempotency_key" },
        );
        if (assetError) throw assetError;
      }
      setSaved(next);
      emitAppEvent("assets:changed");
      emitAppEvent("content:changed");
      toast.success("Saved to Library", {
        description: "You can edit your captions or publish when ready.",
      });
      return true;
    } catch (error) {
      toast.error("Could not save upload", {
        description: error instanceof Error ? error.message : undefined,
      });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const openPublish = async (mode: "publish" | "schedule") => {
    if (await save()) {
      if (mode === "schedule" && !scheduleAt) {
        const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
        setScheduleAt(
          `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
        );
      }
      setPublishMode(mode);
    }
  };

  const submit = async (ids: string[], privacy: string | null) => {
    if (!workspaceId || !publishMode) throw new Error("Choose a workspace and publishing action.");
    const options = { tiktokPrivacyLevel: privacy };
    const result =
      publishMode === "publish"
        ? await publishContentItems(workspaceId, ids, { type: "all" }, options)
        : await scheduleContentItems(
            workspaceId,
            ids.map((id, index) => ({
              contentItemId: id,
              scheduledAt: new Date(
                new Date(scheduleAt).getTime() + index * 10 * 60_000,
              ).toISOString(),
            })),
            { type: "all" },
            options,
          );
    emitAppEvent("content:changed");
    return result;
  };

  return (
    <>
      <AppModalShell
        open={open}
        onOpenChange={(value) => !value && !busy && onClose()}
        size="lg"
        Icon={Upload}
        title={kind ? `Upload ${kind === "text" ? "a post" : `a ${kind}`}` : "Upload your content"}
        description={
          kind
            ? "Add your content, shape the captions, then save or publish."
            : "Start with something you already made."
        }
        bodyClassName="max-h-[min(78dvh,760px)] overflow-y-auto p-4 sm:p-6"
      >
        <div className="space-y-5 studio-tone-upload">
          {!kind ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  {
                    id: "photo",
                    label: "Photo",
                    copy: "Add an image and write or generate captions.",
                    Icon: ImageIcon,
                  },
                  {
                    id: "video",
                    label: "Video",
                    copy: "Bring a clip and tailor its post for each channel.",
                    Icon: Video,
                  },
                  {
                    id: "text",
                    label: "Text post",
                    copy: "Write and publish without media.",
                    Icon: MessageSquare,
                  },
                ] as const
              ).map(({ id, label, copy, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickKind(id)}
                  className="group rounded-2xl border border-border bg-surface-3 p-4 text-left shadow-1 transition-[border-color,transform] hover:-translate-y-0.5 hover:border-[hsl(var(--tone)/0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="studio-glyph mb-5 grid size-11 place-items-center rounded-xl">
                    <Icon className="size-5" />
                  </span>
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                    {copy}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-2" aria-label="Upload type">
                {(
                  [
                    { id: "photo", label: "Photo" },
                    { id: "video", label: "Video" },
                    { id: "text", label: "Text post" },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={kind === option.id}
                    onClick={() => pickKind(option.id)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-xs font-medium",
                      kind === option.id
                        ? "bg-primary-surface text-primary ring-1 ring-primary-border"
                        : "bg-surface-2 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {kind !== "text" ? (
                <label
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface-2/40 px-5 py-6 text-center transition-colors hover:border-primary-border"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    chooseFile(event.dataTransfer.files[0]);
                  }}
                >
                  <input
                    type="file"
                    accept={ACCEPT[kind]}
                    className="sr-only"
                    onChange={(event) => chooseFile(event.target.files?.[0])}
                  />
                  {preview ? (
                    kind === "photo" ? (
                      <img
                        src={preview}
                        alt="Selected upload"
                        className="max-h-44 rounded-xl object-contain"
                      />
                    ) : (
                      <video src={preview} controls className="max-h-44 rounded-xl" />
                    )
                  ) : (
                    <Upload className="size-7 text-[var(--tone-ink)]" />
                  )}
                  <span className="text-sm font-medium">
                    {file ? file.name : `Choose a ${kind}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {kind === "photo"
                      ? "JPG, PNG or WebP · up to 20 MB"
                      : "MP4, MOV or WebM · up to 50 MB"}
                  </span>
                </label>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5 text-xs font-medium">
                  Title{" "}
                  <input
                    className={FIELD}
                    value={title}
                    maxLength={280}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Give this post a name"
                  />
                </label>
                <label className="space-y-1.5 text-xs font-medium">
                  What is it about?{" "}
                  <input
                    className={FIELD}
                    value={description}
                    maxLength={2000}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Context for captions (optional)"
                  />
                </label>
              </div>
              <section data-no-rhythm className="space-y-2">
                <h3 className="ui-eyebrow">Publish to</h3>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map((platform) => (
                    <button
                      key={platform}
                      type="button"
                      disabled={!available(kind, platform)}
                      aria-pressed={selected.includes(platform)}
                      onClick={() =>
                        setPlatforms((current) =>
                          current.includes(platform)
                            ? current.filter((p) => p !== platform)
                            : [...current, platform],
                        )
                      }
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                        selected.includes(platform)
                          ? "border-primary-border bg-primary-surface text-primary"
                          : "border-border bg-surface-2 text-foreground hover:border-border-strong",
                      )}
                    >
                      {PLATFORMS[platform].label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Only channels that support this content type are available.
                </p>
              </section>
              <section data-no-rhythm className="space-y-3">
                <h3 className="ui-eyebrow">Captions</h3>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      { id: "write", label: "Write myself" },
                      { id: "generate", label: "Generate for me" },
                      { id: "both", label: "Write + improve" },
                    ] as const
                  ).map((choice) => (
                    <button
                      key={choice.id}
                      type="button"
                      aria-pressed={copyMode === choice.id}
                      onClick={() => setCopyMode(choice.id)}
                      className={cn(
                        "rounded-xl border px-3 py-2.5 text-left text-xs font-medium transition-colors",
                        copyMode === choice.id
                          ? "border-primary-border bg-primary-surface text-primary"
                          : "border-border bg-surface-2 hover:border-border-strong",
                      )}
                    >
                      {choice.label}
                    </button>
                  ))}
                </div>
                {copyMode !== "write" ? (
                  <div className="space-y-2">
                    <textarea
                      className={cn(FIELD, "min-h-20 resize-y")}
                      value={direction}
                      maxLength={1000}
                      onChange={(event) => setDirection(event.target.value)}
                      placeholder="What should the captions say? Add your tone, offer, facts or call to action."
                    />
                    <Button
                      variant="outline"
                      disabled={!selected.length || !!busy}
                      onClick={() => void generate()}
                    >
                      <Sparkles className="mr-2 size-4" />
                      {busy === "generate"
                        ? "Writing…"
                        : copyMode === "both"
                          ? "Improve captions"
                          : "Generate captions"}
                    </Button>
                  </div>
                ) : null}
                {selected.map((platform) => (
                  <label key={platform} className="block space-y-1.5 text-xs font-medium">
                    {PLATFORMS[platform].label}
                    <textarea
                      className={cn(FIELD, "min-h-24 resize-y")}
                      value={captions[platform] ?? ""}
                      maxLength={4000}
                      onChange={(event) =>
                        setCaptions((current) => ({ ...current, [platform]: event.target.value }))
                      }
                      placeholder={`Write your ${PLATFORMS[platform].label} caption`}
                    />
                  </label>
                ))}
              </section>
              <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
                <Button variant="outline" disabled={!!busy} onClick={() => void save()}>
                  {busy === "save" ? <Spinner className="mr-2 size-4 animate-spin" /> : null}Save
                  draft
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => void openPublish("schedule")}
                >
                  <CalendarClock className="mr-2 size-4" />
                  Schedule
                </Button>
                <Button disabled={!!busy} onClick={() => void openPublish("publish")}>
                  <Send className="mr-2 size-4" />
                  Publish
                </Button>
              </div>
            </>
          )}
        </div>
      </AppModalShell>
      {workspaceId && publishMode ? (
        <StudioPublishFlow
          open
          mode={publishMode}
          workspaceId={workspaceId}
          destinations={destinations as { id: string; platform: PlatformId }[]}
          needsApproval
          scheduleAt={scheduleAt}
          onScheduleAtChange={setScheduleAt}
          onClose={() => setPublishMode(null)}
          onSubmit={submit}
          morePlatforms={[]}
          onAddPlatforms={() => undefined}
          placement="feed"
        />
      ) : null}
    </>
  );
}

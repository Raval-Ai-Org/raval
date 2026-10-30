"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
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
  Palette,
} from "@/components/icons";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { createContentItem, updateContentItem } from "@/lib/content.functions";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { publishContentItems, scheduleContentItems } from "@/lib/sdr.functions";
import { StudioPublishFlow } from "./StudioPublishFlow";
import { PlatformAppIcon } from "@/components/brand/PlatformAppIcon";
import { FieldLabel, PlatformLogoGrid, Segmented } from "./studio-ui";
import { openComposer } from "@/lib/studio/session-store";
import { creditsFor } from "@/lib/billing/catalog";

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
  "w-full rounded-lg border border-input bg-surface-3 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/55";
const KINDS = [
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
  { id: "text", label: "Text post", copy: "Write and publish without media.", Icon: MessageSquare },
] as const;

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
  const [groupId, setGroupId] = useState(() => crypto.randomUUID());
  const [storedPath, setStoredPath] = useState<string | null>(null);
  const [storedUrl, setStoredUrl] = useState<string | null>(null);
  const [storedAssetId, setStoredAssetId] = useState<string | null>(null);
  const [publishMode, setPublishMode] = useState<"publish" | "schedule" | null>(null);
  const [distributed, setDistributed] = useState(false);
  const [scheduleAt, setScheduleAt] = useState("");
  const [dragging, setDragging] = useState(false);
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

  const startNew = () => {
    setKind(null);
    setFile(null);
    setTitle("");
    setDescription("");
    setDirection("");
    setCopyMode("write");
    setPlatforms([]);
    setCaptions({});
    setSaved({});
    setGroupId(crypto.randomUUID());
    setStoredPath(null);
    setStoredUrl(null);
    setStoredAssetId(null);
    setScheduleAt("");
    setDistributed(false);
  };

  const pickKind = (next: UploadKind) => {
    if (busy) return;
    if (next === kind) return;
    setKind(next);
    setFile(null);
    setPlatforms((current) => current.filter((platform) => available(next, platform)));
    setStoredPath(null);
    setStoredUrl(null);
    setStoredAssetId(null);
  };

  const chooseFile = (next: File | undefined) => {
    if (busy) return;
    if (!next || !kind || kind === "text") return;
    if (!ACCEPT[kind].split(",").includes(next.type))
      return void toast.error("Choose a supported image or video file.");
    if (next.size > MAX_BYTES[kind])
      return void toast.error(
        `${kind === "photo" ? "Photos" : "Videos"} must be under ${MAX_BYTES[kind] / 1024 / 1024} MB.`,
      );
    setFile(next);
    setGroupId(crypto.randomUUID());
    setStoredPath(null);
    setStoredUrl(null);
    setStoredAssetId(null);
  };

  const ensureUpload = async () => {
    if (storedPath && storedUrl && storedAssetId)
      return { path: storedPath, url: storedUrl, id: storedAssetId };
    if (!workspaceId || !file || kind === "text") return null;
    const params = new URLSearchParams({ workspaceId, requestId: groupId, filename: file.name });
    const response = await authedFetch(`/api/assets/upload?${params}`, {
      method: "POST",
      workspaceId,
      headers: { "Content-Type": file.type },
      body: file,
    });
    const result = await response.json();
    if (
      !response.ok ||
      !result.asset?.storage_path ||
      !result.asset?.public_url ||
      !result.asset?.id
    )
      throw new Error("Could not upload media.");
    setStoredPath(result.asset.storage_path);
    setStoredUrl(result.asset.public_url);
    setStoredAssetId(result.asset.id);
    return {
      path: result.asset.storage_path as string,
      url: result.asset.public_url as string,
      id: result.asset.id as string,
    };
  };

  /** Studio with this photo (designed around, or as a reference) or this clip (branded). */
  const openReferenceComposer = async (mode: "design" | "reference") => {
    if (busy || (kind !== "photo" && kind !== "video")) return;
    setBusy("save");
    try {
      const asset = await ensureUpload();
      if (!asset)
        throw new Error(kind === "video" ? "Choose a clip first." : "Choose a photo first.");
      const brief = [title, description, direction].filter(Boolean).join("\n\n");
      if (kind === "video")
        openComposer({
          type: "video",
          brief,
          extraControls: { videoMode: "brand", sourceVideoAssetIds: [asset.id] },
        });
      else
        openComposer({
          type: "image",
          brief,
          referenceAssetIds: [asset.id],
          ...(mode === "design" ? { referenceMode: "design" as const } : {}),
        });
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open this photo.");
    } finally {
      setBusy(null);
    }
  };

  const generate = async () => {
    if (!workspaceId || !kind || !selected.length || busy) return;
    if (!title.trim() && !description.trim() && !direction.trim())
      return void toast.error(
        "Add a title, description or direction so the captions have something to say.",
      );
    setBusy("generate");
    try {
      const asset = kind === "photo" ? await ensureUpload() : null;
      if (kind === "photo" && !asset)
        throw new Error("Add a photo before generating its captions.");
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
          ...(asset ? { assetId: asset.id } : {}),
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
      if (kind !== "text") {
        const asset = await ensureUpload();
        if (!asset) throw new Error("Add a photo or video first.");
        path = asset.path;
        url = asset.url;
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
      let mediaIndexed = true;
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
        mediaIndexed = !assetError;
      }
      setSaved(next);
      if (mediaIndexed) emitAppEvent("assets:changed");
      emitAppEvent("content:changed");
      toast.success("Saved to Library", {
        description: mediaIndexed
          ? "You can edit your captions or publish when ready."
          : "Your posts are saved. The media Library could not index this file; saving again will retry.",
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
    if (result.results.some((item) => item.status === "publishing" || item.status === "already"))
      setDistributed(true);
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
        <div className="space-y-6 studio-tone-upload">
          {!kind ? (
            <div className="grid gap-3 sm:grid-cols-3">
              {KINDS.map(({ id, label, copy, Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pickKind(id)}
                  className="group relative isolate overflow-hidden rounded-2xl border border-border/80 bg-surface-3 p-4 text-left shadow-1 transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--tone)/0.45)] hover:shadow-[0_18px_40px_-20px_hsl(var(--tone)/0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]"
                >
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--tone)/0.14),transparent_60%)] opacity-0 transition-opacity duration-[--motion-duration-slow] group-hover:opacity-100"
                  />
                  <span className="studio-glyph mb-5 grid size-11 place-items-center rounded-xl transition-transform duration-[--motion-duration-slow] ease-[--motion-ease-spring] group-hover:-rotate-6 group-hover:scale-110">
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  label="Upload type"
                  value={kind}
                  onChange={pickKind}
                  options={KINDS.map((option) => ({ value: option.id, label: option.label }))}
                />
                {Object.keys(saved).length > 0 ? (
                  <button
                    type="button"
                    onClick={startNew}
                    className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                  >
                    Start a new upload
                  </button>
                ) : null}
              </div>

              {kind !== "text" ? (
                <div>
                  <FieldLabel
                    hint={
                      kind === "photo"
                        ? "JPG, PNG or WebP · up to 20 MB"
                        : "MP4, MOV or WebM · up to 50 MB"
                    }
                  >
                    {kind === "photo" ? "Photo" : "Video"}
                  </FieldLabel>
                  <label
                    className={cn(
                      "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-6 text-center transition-colors focus-within:ring-2 focus-within:ring-ring/55",
                      dragging
                        ? "border-primary bg-primary-surface"
                        : "border-border bg-surface-3 hover:border-primary-border",
                    )}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(event) => {
                      event.preventDefault();
                      setDragging(false);
                      chooseFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <input
                      key={`${kind}-${file ? file.name : "empty"}`}
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
                          className="max-h-48 rounded-xl object-contain"
                        />
                      ) : (
                        <video src={preview} controls className="max-h-48 rounded-xl" />
                      )
                    ) : (
                      <span className="studio-glyph grid size-11 place-items-center rounded-xl">
                        <Upload className="size-5" />
                      </span>
                    )}
                    <span className="max-w-full truncate text-sm font-medium">
                      {file ? file.name : `Drop a ${kind} here or click to choose`}
                    </span>
                    {file ? (
                      <span className="text-xs text-muted-foreground">
                        {(file.size / 1024 / 1024).toFixed(1)} MB · click to replace
                      </span>
                    ) : null}
                  </label>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="upload-title" hint="Optional">
                    Title
                  </FieldLabel>
                  <input
                    id="upload-title"
                    className={FIELD}
                    value={title}
                    maxLength={280}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="Give this post a name"
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="upload-about" hint="Optional">
                    What is it about?
                  </FieldLabel>
                  <input
                    id="upload-about"
                    className={FIELD}
                    value={description}
                    maxLength={2000}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder="Context for captions"
                  />
                </div>
              </div>

              <section data-no-rhythm>
                <FieldLabel hint="Only channels that fit this content">Platforms</FieldLabel>
                <PlatformLogoGrid
                  platforms={CHANNELS}
                  isSelected={(platform) => selected.includes(platform)}
                  isDisabled={(platform) => !available(kind, platform)}
                  onToggle={(platform) =>
                    setPlatforms((current) =>
                      current.includes(platform)
                        ? current.filter((p) => p !== platform)
                        : [...current, platform],
                    )
                  }
                />
              </section>

              {(kind === "photo" || kind === "video") && (file || storedPath) && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface-3 p-3.5">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-surface text-foreground">
                    <Palette className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      {kind === "video"
                        ? "Add your design to this clip"
                        : "Make it a designed post"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {kind === "video"
                        ? "Your footage stays as filmed."
                        : "Your photo stays exactly as it is."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {kind === "photo" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!!busy}
                        onClick={() => void openReferenceComposer("reference")}
                      >
                        Other ways
                      </Button>
                    )}
                    <Button
                      size="sm"
                      disabled={!!busy}
                      onClick={() => void openReferenceComposer("design")}
                    >
                      {kind === "video" ? "Design this clip" : "Design it"}
                    </Button>
                  </div>
                </div>
              )}

              <section data-no-rhythm className="space-y-3">
                <FieldLabel>Captions</FieldLabel>
                <p className="text-xs text-muted-foreground">
                  Writing, uploading and saving are free. Generating captions costs{" "}
                  {creditsFor("ideas")} credits.
                </p>
                <Segmented
                  label="Caption mode"
                  value={copyMode}
                  onChange={setCopyMode}
                  options={[
                    { value: "write", label: "Write myself" },
                    { value: "generate", label: "Generate for me" },
                    { value: "both", label: "Write + improve" },
                  ]}
                />
                {copyMode !== "write" ? (
                  <div className="space-y-2 rounded-xl border border-border bg-surface-3 p-3.5">
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
                      {busy === "generate" ? (
                        <Spinner className="mr-2 size-4 animate-spin" />
                      ) : (
                        <Sparkles className="mr-2 size-4" />
                      )}
                      {busy === "generate"
                        ? "Writing…"
                        : copyMode === "both"
                          ? "Improve captions"
                          : "Generate captions"}
                    </Button>
                    {!selected.length ? (
                      <p className="text-xs text-muted-foreground">
                        Choose a platform first so captions fit it.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {selected.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-3.5 py-4 text-center text-xs text-muted-foreground">
                    Pick a platform above to write its caption.
                  </p>
                ) : null}
                {selected.map((platform) => {
                  return (
                    <div key={platform}>
                      <FieldLabel
                        htmlFor={`upload-caption-${platform}`}
                        hint={`${(captions[platform] ?? "").length}/4000`}
                      >
                        <span className="inline-flex items-center gap-2">
                          <PlatformAppIcon platform={platform} size={20} />
                          {PLATFORMS[platform].label}
                        </span>
                      </FieldLabel>
                      <textarea
                        id={`upload-caption-${platform}`}
                        className={cn(FIELD, "min-h-24 resize-y")}
                        value={captions[platform] ?? ""}
                        maxLength={4000}
                        onChange={(event) =>
                          setCaptions((current) => ({
                            ...current,
                            [platform]: event.target.value,
                          }))
                        }
                        placeholder={`Write your ${PLATFORMS[platform].label} caption`}
                      />
                    </div>
                  );
                })}
              </section>

              <div className="sticky -bottom-4 -mx-4 flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-surface-3 px-4 py-3 sm:-bottom-6 sm:-mx-6 sm:px-6">
                <Button variant="ghost" disabled={!!busy} onClick={() => void save()}>
                  {busy === "save" ? <Spinner className="mr-2 size-4 animate-spin" /> : null}
                  Save draft
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
          onClose={() => {
            setPublishMode(null);
            if (distributed) {
              onClose();
              startNew();
            }
          }}
          onSubmit={submit}
          morePlatforms={[]}
          onAddPlatforms={() => undefined}
          placement="feed"
        />
      ) : null}
    </>
  );
}

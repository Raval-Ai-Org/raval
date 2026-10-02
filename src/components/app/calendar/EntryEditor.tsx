"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import {
  Check,
  Clock,
  Copy,
  History,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "@/components/icons";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { dsIconBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { streamImage } from "@/lib/streamImage";
import { persistGeneratedAsset } from "@/lib/persistent-assets";
import { rememberedStyle } from "@/lib/studio/session-store";
import {
  CALENDAR_CHANNELS,
  channelInfo,
  isLocked,
  type CalendarChannel,
  type CalendarEntry,
  type VersionSnapshot,
} from "@/lib/calendar/model";
import { ChannelBadge, StatusChip } from "./shared";

export type EntryPatch = Partial<Pick<CalendarEntry, "title" | "caption" | "hashtags" | "channel">>;

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

/* Earlier wording of a post, kept in this browser so a rewrite can be undone. */
const VERSIONS_KEY = (workspaceId: string) => `content-calendar:versions:${workspaceId}`;

function readVersions(workspaceId: string, id: string): VersionSnapshot[] {
  try {
    const all = JSON.parse(localStorage.getItem(VERSIONS_KEY(workspaceId)) ?? "{}");
    return Array.isArray(all?.[id]) ? all[id] : [];
  } catch {
    return [];
  }
}

function writeVersions(workspaceId: string, id: string, versions: VersionSnapshot[]) {
  try {
    const all = JSON.parse(localStorage.getItem(VERSIONS_KEY(workspaceId)) ?? "{}") ?? {};
    if (versions.length) all[id] = versions;
    else delete all[id];
    // Keep the store small: only the 40 most recently touched posts.
    const keys = Object.keys(all);
    for (const key of keys.slice(0, Math.max(0, keys.length - 40))) delete all[key];
    localStorage.setItem(VERSIONS_KEY(workspaceId), JSON.stringify(all));
  } catch {}
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="ds-label mb-1">{label}</div>
      {children}
    </label>
  );
}

function formatAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}

export function EntryEditor({
  workspaceId,
  entry,
  busy,
  canSchedule,
  onChange,
  onMove,
  onPicture,
  onApprove,
  onBackToDraft,
  onSchedule,
  onCancelSchedule,
  onRegenerate,
  onDuplicate,
  onDelete,
  onClose,
}: {
  workspaceId: string;
  entry: CalendarEntry;
  /** A request for this post is in flight (rewrite, schedule, approve…). */
  busy: boolean;
  /** Mellox can post to this channel for this workspace. */
  canSchedule: boolean;
  onChange: (patch: EntryPatch) => void;
  onMove: (date: string, time: string) => void;
  onPicture: (url: string) => void;
  onApprove: () => void;
  onBackToDraft: () => void;
  onSchedule: () => void;
  onCancelSchedule: () => void;
  onRegenerate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const channel = channelInfo(entry.channel);
  const locked = isLocked(entry.status);
  const picture = entry.images[0];
  const [versions, setVersions] = useState<VersionSnapshot[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pictureBusy, setPictureBusy] = useState<"upload" | "ai" | null>(null);
  const [preview, setPreview] = useState<string | undefined>();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVersions(readVersions(workspaceId, entry.id));
    setShowHistory(false);
    setPreview(undefined);
  }, [workspaceId, entry.id]);

  const snapshot = (label: "auto" | "manual" = "auto") => {
    const last = versions[0];
    if (
      last &&
      last.title === entry.title &&
      (last.caption ?? "") === (entry.caption ?? "") &&
      (last.hashtags ?? []).join(" ") === entry.hashtags.join(" ")
    )
      return;
    if (!entry.caption && !entry.hashtags.length) return;
    const next = [
      {
        id: `v-${Date.now()}`,
        at: Date.now(),
        label,
        title: entry.title,
        caption: entry.caption,
        hashtags: entry.hashtags,
      },
      ...versions,
    ].slice(0, 12);
    setVersions(next);
    writeVersions(workspaceId, entry.id, next);
  };

  const restore = (v: VersionSnapshot) => {
    snapshot();
    onChange({ title: v.title, caption: v.caption, hashtags: v.hashtags ?? [] });
    setShowHistory(false);
    toast.success("Earlier version restored");
  };

  const savePicture = async (dataUrl: string, filename: string) => {
    const asset = (await persistGeneratedAsset({
      workspaceId,
      contentItemId: entry.id,
      dataUrl,
      idempotencyKey: crypto.randomUUID(),
      filename,
      platform: entry.channel,
    })) as { public_url?: string | null };
    // The stored copy is what publishing uses; show it once it exists.
    onPicture(asset.public_url || dataUrl);
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) return void toast.error("Choose an image file");
    if (file.size > MAX_UPLOAD_BYTES) return void toast.error("That image is over 8 MB");
    setPictureBusy("upload");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(new Error("Couldn't read the image"));
        reader.readAsDataURL(file);
      });
      setPreview(dataUrl);
      await savePicture(dataUrl, file.name);
      toast.success("Picture added");
    } catch (e) {
      toast.error("Couldn't add the picture", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPreview(undefined);
      setPictureBusy(null);
    }
  };

  const createPicture = async () => {
    const subject = [entry.title, entry.caption].filter(Boolean).join(" — ").slice(0, 600);
    if (!subject.trim()) return void toast.error("Add a title or caption first");
    setPictureBusy("ai");
    try {
      let final = "";
      await streamImage(
        `Create a clean, on-brand ${channel.label} ${entry.format.toLowerCase()} visual. Subject: ${subject}. Modern, premium, high contrast, no text overlay.`,
        (dataUrl, isFinal) => {
          setPreview(dataUrl);
          if (isFinal) final = dataUrl;
        },
        // The workspace's Brand Kit style, applied (and checked) on the server.
        { brandStyle: rememberedStyle(workspaceId) || "default" },
      );
      if (!final) throw new Error("No picture came back");
      await savePicture(final, "calendar-visual.png");
      toast.success("Picture ready");
    } catch (e) {
      toast.error("Couldn't create the picture", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPreview(undefined);
      setPictureBusy(null);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        [entry.title, entry.caption, entry.hashtags.join(" ")].filter(Boolean).join("\n\n"),
      );
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const input =
    "w-full rounded-xl border border-input bg-background px-3 text-[12.5px] outline-none focus:border-primary disabled:opacity-60";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-20 bg-background/60 backdrop-blur-sm"
      // Only a click on the backdrop itself closes: clicks inside the panel or
      // the (portalled) delete dialog bubble here too.
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        role="dialog"
        aria-label="Edit post"
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l border-border bg-card"
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <ChannelBadge channel={entry.channel} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">
                {channel.label} · {entry.format}
              </div>
              {entry.topic && (
                <div className="truncate text-[11px] text-muted-foreground">{entry.topic}</div>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <StatusChip status={entry.status} />
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className={cn(
                dsIconBtn,
                showHistory && "bg-[var(--ds-well-bg-hover)] text-foreground",
              )}
              aria-label="Earlier versions"
              title="Earlier versions"
            >
              <History className="h-4 w-4" />
            </button>
            <button type="button" onClick={onClose} className={dsIconBtn} aria-label="Close post">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-thin">
          {locked && (
            <div className="rounded-xl bg-[var(--ds-well-bg)] px-3 py-2 text-[12px] text-muted-foreground">
              {entry.status === "scheduled"
                ? "Scheduled. Cancel the schedule to change this post."
                : entry.status === "publishing"
                  ? "This post is going out now."
                  : "This post is live."}
            </div>
          )}

          <Field label="Title">
            <Input
              value={entry.title}
              disabled={locked}
              maxLength={280}
              onFocus={() => snapshot()}
              onChange={(e) => onChange({ title: e.target.value })}
              className="h-9 text-[12.5px]"
            />
          </Field>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1.3fr_1fr_1fr]">
            <Field label="Date">
              <Input
                type="date"
                value={entry.date}
                disabled={locked}
                onChange={(e) => e.target.value && onMove(e.target.value, entry.time)}
                className="h-9 px-2 text-[12px]"
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={entry.time}
                disabled={locked}
                onChange={(e) => e.target.value && onMove(entry.date, e.target.value)}
                className="h-9 px-2 text-[12px]"
              />
            </Field>
            <Field label="Channel">
              <select
                value={entry.channel}
                disabled={locked}
                onChange={(e) => onChange({ channel: e.target.value as CalendarChannel })}
                className={cn(input, "h-9 px-2")}
              >
                {CALENDAR_CHANNELS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Caption">
            <textarea
              value={entry.caption ?? ""}
              disabled={locked}
              rows={9}
              onFocus={() => snapshot()}
              onChange={(e) => onChange({ caption: e.target.value })}
              className={cn(input, "resize-y py-2 leading-relaxed")}
            />
          </Field>

          <Field label="Hashtags">
            <Input
              value={entry.hashtags.join(" ")}
              disabled={locked}
              onFocus={() => snapshot()}
              onChange={(e) =>
                onChange({ hashtags: e.target.value.split(/\s+/).filter(Boolean).slice(0, 30) })
              }
              placeholder="#brand #launch"
              className="h-9 text-[12.5px]"
            />
          </Field>

          <div>
            <div className="ds-label mb-1">Picture</div>
            {preview || picture ? (
              <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
                <img
                  src={preview ?? picture}
                  alt=""
                  className={cn(
                    "block max-h-64 w-full object-cover",
                    pictureBusy === "ai" && "blur-md",
                  )}
                />
                {pictureBusy && (
                  <div className="absolute inset-0 grid place-items-center bg-background/30">
                    <span className="flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-[11px] font-medium">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {pictureBusy === "ai" ? "Creating…" : "Saving…"}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid place-items-center rounded-xl border border-dashed border-border py-7 text-muted-foreground">
                <ImageIcon className="h-5 w-5" />
              </div>
            )}
            {!locked && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!pictureBusy}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload /> {picture ? "Replace" : "Upload"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!pictureBusy}
                  onClick={createPicture}
                >
                  <Sparkles /> Create with AI
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    void upload(e.target.files?.[0]);
                    e.currentTarget.value = "";
                  }}
                />
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 border-t border-border p-3">
          <div className="flex items-center gap-2">
            {entry.status === "scheduled" ? (
              <Button
                variant="outline"
                className="flex-1"
                disabled={busy}
                onClick={onCancelSchedule}
              >
                {busy ? <Loader2 className="animate-spin" /> : <X />} Cancel schedule
              </Button>
            ) : locked ? null : entry.status === "approved" ? (
              <>
                <Button variant="outline" disabled={busy} onClick={onBackToDraft}>
                  Back to draft
                </Button>
                {canSchedule && (
                  <Button className="flex-1" disabled={busy} onClick={onSchedule}>
                    {busy ? <Loader2 className="animate-spin" /> : <Clock />} Schedule
                  </Button>
                )}
              </>
            ) : (
              <>
                {canSchedule && (
                  <Button variant="outline" disabled={busy} onClick={onSchedule}>
                    <Clock /> Schedule
                  </Button>
                )}
                <Button className="flex-1" disabled={busy} onClick={onApprove}>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Approve
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-0.5">
              {!locked && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    snapshot();
                    onRegenerate();
                  }}
                  className={dsIconBtn}
                  aria-label="Rewrite"
                  title="Rewrite"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={copy}
                className={dsIconBtn}
                aria-label="Copy text"
                title="Copy text"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onDuplicate}
                className={cn(dsIconBtn, "w-auto px-2.5 text-[12px] font-medium")}
              >
                Duplicate
              </button>
            </div>
            {entry.status !== "scheduled" && entry.status !== "publishing" && (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className={cn(dsIconBtn, "hover:text-destructive")}
                aria-label="Delete post"
                title="Delete post"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showHistory && (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              className="absolute inset-x-0 bottom-0 top-[57px] z-30 flex flex-col bg-card"
            >
              <div className="flex-1 overflow-y-auto p-3 scrollbar-thin">
                {versions.length === 0 ? (
                  <p className="px-2 py-10 text-center text-[12.5px] text-muted-foreground">
                    No earlier versions yet.
                  </p>
                ) : (
                  <ol className="space-y-2">
                    {versions.map((v) => (
                      <li key={v.id} className="ds-tile p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] text-muted-foreground">
                            {formatAgo(v.at)}
                          </span>
                          {!locked && (
                            <Button size="sm" variant="outline" onClick={() => restore(v)}>
                              <RotateCcw /> Restore
                            </Button>
                          )}
                        </div>
                        <div className="mt-1 truncate text-[12.5px] font-medium">
                          {v.title || "Untitled"}
                        </div>
                        {v.caption && (
                          <div className="mt-0.5 line-clamp-3 text-[11.5px] text-muted-foreground">
                            {v.caption}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent className="rounded-[28px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this post?</AlertDialogTitle>
            <AlertDialogDescription>
              {entry.title}. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-full">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="rounded-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}

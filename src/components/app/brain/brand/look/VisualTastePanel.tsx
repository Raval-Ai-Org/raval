"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, RefreshCw, Spinner, X } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getVisualTaste,
  scanVisualWebsite,
  learnVisualReferences,
  updateVisualReference,
  saveVisualDirection,
  cancelVisualScan,
  addVisualReference,
  restoreManualVisualLook,
} from "@/lib/brand-visuals.functions";
import type { VisualView, VisualProfile, VisualSource } from "@/lib/brand-visuals/contracts";
import type { BrandDna } from "@/hooks/use-brand-dna";
import { resolveLook } from "@/lib/brand-look/resolve";
import { applyVisualTaste } from "@/lib/brand-visuals/apply";
import { directionRules } from "@/lib/brand-visuals/contracts";
import { authedFetch } from "@/lib/authed-fetch";
import { dsFocus, dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { Field, Segmented } from "./controls";
import { useLookFonts } from "./preview";
import { fontStack } from "@/lib/brand-look/fonts";
import { carouselTheme } from "@/lib/studio/carousel/design";

const inputClass = cn("ds-well w-full min-w-0 px-3 py-2.5 text-[13px] text-foreground", dsFocus);
const buttonClass = cn(dsGhostBtn, "h-9 px-3 text-[12px]");
function DirectionPreview({
  dna,
  profile,
  index,
  sources,
}: {
  dna: BrandDna;
  profile: VisualProfile;
  index: number;
  sources: VisualSource[];
}) {
  const direction = profile.directions[index];
  const look = applyVisualTaste(resolveLook(dna), dna.look, {
    profileId: "preview",
    direction,
    rules: directionRules(direction),
    references: [],
    warnings: [],
  });
  useLookFonts(look);
  const theme = carouselTheme({
    palette: look.visual.palette,
    fonts: look.visual.typography,
    colorway: direction.colorway,
  });
  const reference = sources.find(
    (s) =>
      direction.sourceIds.includes(s.id) &&
      s.status !== "removed" &&
      s.asset?.mime_type.startsWith("image/") &&
      s.region.type !== "full",
  );
  const soft = direction.layout === "soft";
  const bold = direction.layout === "bold";
  return (
    <div
      className={cn(
        "relative flex aspect-square overflow-hidden rounded-[18px] [container-type:inline-size]",
        direction.layout === "frame" ? "flex-col-reverse" : "flex-col",
        soft && "p-[3%]",
      )}
      style={{
        background: bold ? theme.accent : theme.bg,
        color: bold ? theme.accentInk : theme.ink,
      }}
    >
      <div
        className={cn("relative h-[60%] shrink-0 overflow-hidden", soft && "rounded-[14px]")}
        style={{ background: theme.surface }}
      >
        {reference?.asset?.url ? (
          <img
            src={reference.asset.thumbnailUrl || reference.asset.url}
            alt=""
            decoding="async"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center text-[11px] opacity-60">
            Your brand imagery
          </div>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 px-[6%] py-[3%]">
        <div
          className="text-[clamp(12px,5cqw,23px)] font-bold leading-tight"
          style={{
            fontFamily: fontStack(theme.headingFont),
            fontWeight: look.visual.typography?.headingWeight ?? 700,
            letterSpacing:
              look.visual.typography?.tracking === "wide"
                ? "0.06em"
                : look.visual.typography?.tracking === "tight"
                  ? "-0.03em"
                  : undefined,
          }}
        >
          Made for your next chapter
        </div>
        <div
          className="text-[clamp(9px,2.5cqw,12px)] opacity-80"
          style={{ fontFamily: fontStack(theme.bodyFont) }}
        >
          {dna.brandName || "Your brand"}
        </div>
      </div>
    </div>
  );
}

/** Additional tiles in the existing editor. No new window, navigation or styling system. */
export function VisualTastePanel({
  workspaceId,
  dna,
  fixture,
}: {
  workspaceId: string;
  dna: BrandDna;
  fixture?: VisualView;
}) {
  const [view, setView] = useState<VisualView | null>(fixture ?? null);
  const [draft, setDraft] = useState<VisualProfile | null>(null);
  const [url, setUrl] = useState(dna.websiteUrl ?? "");
  const [pages, setPages] = useState("4");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [purpose, setPurpose] = useState<VisualSource["purpose"]>("style");
  const [notes, setNotes] = useState("");
  const [campaign, setCampaign] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [removed, setRemoved] = useState<VisualSource | null>(null);
  const [library, setLibrary] = useState<
    Array<{ id: string; name: string; thumbnailUrl: string; url: string }>
  >([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [format, setFormat] = useState("all");
  const fileRef = useRef<HTMLInputElement>(null);
  const live = useRef(true);
  const reload = useCallback(async () => {
    if (fixture) return;
    try {
      const next = await getVisualTaste({ data: { workspaceId } });
      if (live.current) {
        setView(next);
        setError("");
      }
    } catch (cause) {
      if (live.current)
        setError(
          cause instanceof Error ? cause.message : "Your visual references could not be loaded.",
        );
    }
  }, [workspaceId, fixture]);
  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);
  const running = view?.jobs.find((j) => j.status === "queued" || j.status === "running");
  const runningId = running?.id;
  useEffect(() => {
    if (!runningId || fixture) return;
    const timer = setInterval(() => void reload(), 4000);
    return () => clearInterval(timer);
  }, [runningId, reload, fixture]);
  const newest = view?.profiles[0];
  const draftProfileId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (newest && draftProfileId.current !== newest.id) {
      draftProfileId.current = newest.id;
      setDraft(newest.profile);
    }
  }, [newest]);
  const perform = async (name: string, action: () => Promise<VisualView>) => {
    if (fixture) {
      if (name === "manual")
        setView((current) => (current ? { ...current, activeId: null } : current));
      if (name === "approve" && draft)
        setView((current) =>
          current
            ? {
                ...current,
                activeId: "fixture-approved",
                profiles: [
                  {
                    id: "fixture-approved",
                    workspace_id: workspaceId,
                    status: "approved",
                    profile: draft,
                    created_at: new Date().toISOString(),
                    capture_job_id: null,
                  },
                  ...current.profiles,
                ],
              }
            : current,
        );
      return;
    }
    setBusy(name);
    setError("");
    try {
      const next = await action();
      if (live.current) setView(next);
    } catch (cause) {
      if (live.current)
        setError(cause instanceof Error ? cause.message : "That change could not be saved.");
    } finally {
      if (live.current) setBusy(null);
    }
  };
  const upload = async (file?: File) => {
    if (!file && !sourceUrl.trim()) return;
    setBusy("upload");
    setError("");
    try {
      if (file && file.size > 20 * 1024 * 1024) throw new Error("Choose a reference up to 20 MB.");
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw new Error("Sign in again to add a reference.");
      const body = new FormData();
      body.set("workspaceId", workspaceId);
      body.set("purpose", purpose);
      body.set("notes", notes);
      body.set("campaign", campaign);
      body.set("format", format);
      if (file) body.set("file", file);
      else body.set("sourceUrl", sourceUrl.trim());
      const response = await fetch(
        `/api/brand-visuals/upload?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "POST", headers: { authorization: `Bearer ${session.access_token}` }, body },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "This reference could not be added.");
      await reload();
      if (live.current) {
        setNotes("");
        setSourceUrl("");
        toast.success("Reference added");
      }
    } catch (cause) {
      if (live.current)
        setError(cause instanceof Error ? cause.message : "This reference could not be added.");
    } finally {
      if (live.current) setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  if (!view && !error)
    return (
      <div className="ds-tile p-4 text-[13px] text-muted-foreground" role="status">
        <Spinner className="mr-2 inline size-4 animate-spin" />
        Loading your visual references
      </div>
    );
  if (view && !view.available)
    return (
      <div className="ds-tile p-4 text-[13px] text-muted-foreground">
        Visual references are not available yet.
      </div>
    );
  const canEdit = !!view?.canEdit && !busy;
  const active = view?.profiles.find((p) => p.id === view.activeId);
  const selected = draft?.directions[draft.selected];
  const update = (patch: Partial<NonNullable<typeof selected>>) => {
    if (draft && selected)
      setDraft({
        ...draft,
        directions: draft.directions.map((d, i) => (i === draft.selected ? { ...d, ...patch } : d)),
      });
  };
  const references =
    view?.sources.filter((s) => s.kind !== "website" && s.status !== "removed") ?? [];
  const removedSources = view?.sources.filter((s) => s.status === "removed") ?? [];
  const captures =
    view?.sources.filter(
      (s) => s.kind === "website" && s.region.type === "full" && s.status !== "removed",
    ) ?? [];
  return (
    <div className="space-y-5" data-testid="visual-taste-panel">
      {error && (
        <div role="alert" className="ds-well px-4 py-3 text-[13px] text-destructive">
          {error}
        </div>
      )}
      <section className="ds-tile space-y-4 p-4 sm:p-5" aria-label="Website look">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-[14px] font-semibold">Learn your website's look</h4>
          {active && <span className="text-[12px] text-muted-foreground">Direction saved</span>}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className={inputClass}
            aria-label="Website to scan"
            placeholder="https://yourcompany.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={!view?.canEdit}
          />
          <button
            className={buttonClass}
            disabled={!canEdit || !!running || !url.trim()}
            onClick={() =>
              void perform("scan", () =>
                scanVisualWebsite({
                  data: {
                    workspaceId,
                    url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
                    maxPages: Number(pages),
                    idempotencyKey: crypto.randomUUID(),
                  },
                }),
              )
            }
          >
            <RefreshCw className="size-3.5" />
            Scan website
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Website scan coverage"
            className="ds-well rounded-full px-3 py-2 text-[12px]"
            value={pages}
            onChange={(e) => setPages(e.target.value)}
            disabled={!canEdit}
          >
            <option value="1">Homepage</option>
            <option value="4">Up to 4 pages</option>
            <option value="8">Up to 8 pages</option>
          </select>
          <span className="text-[12px] text-muted-foreground">
            {view?.profiles.length
              ? "125 credits to learn a new direction"
              : "Your first direction is included"}
          </span>
        </div>
        {running && (
          <div
            className="ds-well flex items-center justify-between gap-3 px-3 py-2.5"
            role="status"
          >
            <span className="text-[12px]">
              <Spinner className="mr-2 inline size-3.5 animate-spin" />
              {running.stage === "analysing"
                ? "Finding your visual direction"
                : "Capturing your pages"}{" "}
              · {running.next_page} captured
            </span>
            <button
              className={cn(dsFocus, "text-[12px] text-muted-foreground")}
              onClick={() =>
                void perform("cancel", () =>
                  cancelVisualScan({ data: { workspaceId, id: running.id } }),
                )
              }
              disabled={!canEdit}
            >
              Cancel
            </button>
          </div>
        )}
        {!running && view?.jobs[0]?.error && (
          <p className="text-[12px] text-muted-foreground" role="status">
            {view.jobs[0].error}
          </p>
        )}
        {captures.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {captures.slice(0, 8).map((s) => (
              <a
                key={s.id}
                href={s.asset?.url}
                target="_blank"
                rel="noreferrer"
                className={cn("ds-well overflow-hidden rounded-[16px]", dsFocus)}
                aria-label={`Open capture ${s.label}`}
              >
                <img
                  src={s.asset?.thumbnailUrl || s.asset?.url}
                  loading="lazy"
                  decoding="async"
                  alt={s.label}
                  className="aspect-[4/3] w-full object-cover object-top"
                />
                <div className="truncate px-2 py-2 text-[11px]">{s.label}</div>
              </a>
            ))}
          </div>
        )}
        {view?.sources.some(
          (s) => s.kind === "website" && s.region.type === "section" && s.status !== "removed",
        ) && (
          <details className="text-[12px] text-muted-foreground">
            <summary className={cn(dsFocus, "cursor-pointer rounded-full")}>
              Review captured details
            </summary>
            <p className="mt-2 text-[11px] leading-relaxed">
              Exclude customer examples or details that do not represent your brand. Learn a new
              direction after changing its evidence.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {view.sources
                .filter(
                  (s) =>
                    s.kind === "website" && s.region.type === "section" && s.status !== "removed",
                )
                .slice(0, 24)
                .map((s) => (
                  <div key={s.id} className="ds-well min-w-0 overflow-hidden rounded-[16px]">
                    <a href={s.asset?.url} target="_blank" rel="noreferrer">
                      <img
                        src={s.asset?.thumbnailUrl || s.asset?.url}
                        loading="lazy"
                        decoding="async"
                        alt={s.label}
                        className="aspect-[4/3] w-full object-cover"
                      />
                    </a>
                    <div className="space-y-2 p-2.5">
                      <p className="truncate text-[11px]">{s.label}</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className={cn(dsFocus, "text-[11px]")}
                          disabled={!canEdit}
                          onClick={() =>
                            void perform("exclude-crop", () =>
                              updateVisualReference({
                                data: { workspaceId, id: s.id, status: "removed" },
                              }),
                            )
                          }
                        >
                          Exclude
                        </button>
                        {s.status !== "approved" && (
                          <button
                            className={cn(dsFocus, "text-[11px]")}
                            disabled={!canEdit}
                            onClick={() =>
                              void perform("approve-crop", () =>
                                updateVisualReference({
                                  data: { workspaceId, id: s.id, status: "approved" },
                                }),
                              )
                            }
                          >
                            Use as reference
                          </button>
                        )}
                        {s.status === "approved" && (
                          <span className="text-[11px] text-primary">Approved</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          </details>
        )}
      </section>
      <section className="ds-tile space-y-4 p-4 sm:p-5" aria-label="Visual references">
        <h4 className="text-[14px] font-semibold">References you like</h4>
        {references.length > 0 && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {references.map((s) => (
              <div key={s.id} className="ds-well min-w-0 overflow-hidden rounded-[16px]">
                {s.asset?.mime_type.startsWith("video/") ? (
                  <video
                    src={s.asset.url}
                    controls
                    preload="metadata"
                    className="aspect-square w-full object-cover"
                  />
                ) : (
                  <a href={s.asset?.url} target="_blank" rel="noreferrer">
                    <img
                      src={s.asset?.thumbnailUrl || s.asset?.url}
                      loading="lazy"
                      decoding="async"
                      alt={s.label}
                      className="aspect-square w-full object-cover"
                    />
                  </a>
                )}
                <div className="space-y-2 p-2.5">
                  <div className="truncate text-[12px] font-medium">{s.label}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {s.purpose === "avoid" ? "Avoid this" : s.purpose}
                  </div>
                  {s.notes && (
                    <p className="line-clamp-2 text-[11px] text-muted-foreground">{s.notes}</p>
                  )}
                  <button
                    className={cn(
                      dsFocus,
                      "inline-flex items-center gap-1 text-[11px] text-muted-foreground",
                    )}
                    disabled={!canEdit}
                    onClick={() => {
                      setRemoved(s);
                      void perform("remove", () =>
                        updateVisualReference({
                          data: { workspaceId, id: s.id, status: "removed" },
                        }),
                      );
                    }}
                  >
                    <X className="size-3" />
                    Remove
                  </button>
                  <details className="text-[11px] text-muted-foreground">
                    <summary className={cn(dsFocus, "cursor-pointer rounded-full")}>
                      Edit reference
                    </summary>
                    <form
                      className="mt-2 space-y-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const values = new FormData(event.currentTarget);
                        void perform("reference-edit", () =>
                          updateVisualReference({
                            data: {
                              workspaceId,
                              id: s.id,
                              status: s.status,
                              notes: String(values.get("notes") ?? ""),
                              purpose: String(
                                values.get("purpose") ?? s.purpose,
                              ) as VisualSource["purpose"],
                            },
                          }),
                        );
                      }}
                    >
                      <label className="block">
                        Use for
                        <select
                          name="purpose"
                          aria-label={`Purpose for ${s.label}`}
                          defaultValue={s.purpose}
                          className={cn(inputClass, "mt-1")}
                          disabled={!canEdit}
                        >
                          {["style", "product", "person", "inspiration", "avoid"].map((value) => (
                            <option key={value} value={value}>
                              {value === "style" ? "Look" : value}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        What to follow or avoid
                        <textarea
                          name="notes"
                          aria-label={`Notes for ${s.label}`}
                          defaultValue={s.notes}
                          maxLength={600}
                          className={cn(inputClass, "mt-1")}
                          disabled={!canEdit}
                        />
                      </label>
                      <button className={buttonClass} disabled={!canEdit} type="submit">
                        Save reference
                      </button>
                    </form>
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
        {removed && (
          <button
            className={buttonClass}
            disabled={!canEdit}
            onClick={() =>
              void perform("undo", async () => {
                const next = await updateVisualReference({
                  data: { workspaceId, id: removed.id, status: "approved" },
                });
                setRemoved(null);
                return next;
              })
            }
          >
            Undo removal
          </button>
        )}
        {removedSources.length > 0 && (
          <details className="text-[12px] text-muted-foreground">
            <summary className={cn(dsFocus, "cursor-pointer rounded-full")}>
              Removed references
            </summary>
            <div className="mt-2 space-y-2">
              {removedSources.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{s.label}</span>
                  <button
                    className={buttonClass}
                    disabled={!canEdit}
                    onClick={() =>
                      void perform("restore-reference", () =>
                        updateVisualReference({
                          data: { workspaceId, id: s.id, status: "approved" },
                        }),
                      )
                    }
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
        <Field label="Use this reference for">
          <Segmented
            value={purpose}
            onChange={(v) => setPurpose((v ?? "style") as VisualSource["purpose"])}
            options={[
              { value: "style", label: "Look" },
              { value: "product", label: "Product" },
              { value: "person", label: "Person" },
              { value: "inspiration", label: "Inspiration" },
              { value: "avoid", label: "Avoid" },
            ]}
          />
        </Field>
        <input
          className={inputClass}
          aria-label="What you like about the reference"
          placeholder="What should Mellox follow? e.g. the layout and lighting"
          maxLength={600}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!view?.canEdit}
        />
        <details className="text-[12px] text-muted-foreground">
          <summary className={cn(dsFocus, "cursor-pointer rounded-full")}>
            Limit to a campaign or format
          </summary>
          <input
            className={cn(inputClass, "mt-2")}
            aria-label="Reference campaign"
            placeholder="Campaign name (optional)"
            maxLength={120}
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
          />
          <div className="mt-3">
            <Field label="Use for">
              <Segmented
                value={format}
                onChange={(value) => setFormat(value ?? "all")}
                options={[
                  { value: "all", label: "All" },
                  { value: "image", label: "Posts" },
                  { value: "carousel", label: "Carousels" },
                  { value: "story", label: "Stories" },
                  { value: "video", label: "Video" },
                  { value: "ad", label: "Ads" },
                  { value: "ugc", label: "UGC" },
                ]}
              />
            </Field>
          </div>
        </details>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={!canEdit}
            onClick={async () => {
              if (showLibrary) {
                setShowLibrary(false);
                return;
              }
              setBusy("library");
              try {
                const response = await authedFetch(
                  `/api/assets/library?workspaceId=${encodeURIComponent(workspaceId)}`,
                  { workspaceId },
                );
                const result = await response.json();
                if (!response.ok) throw new Error("Your library could not be opened.");
                setLibrary(
                  (result.assets ?? [])
                    .filter(
                      (a: { type: string; storagePath?: string }) =>
                        a.type === "image" && !!a.storagePath,
                    )
                    .slice(0, 24),
                );
                setShowLibrary(true);
              } catch (cause) {
                setError(
                  cause instanceof Error ? cause.message : "Your library could not be opened.",
                );
              } finally {
                setBusy(null);
              }
            }}
          >
            Choose from library
          </button>
          <button
            className={buttonClass}
            disabled={!canEdit}
            onClick={() => fileRef.current?.click()}
          >
            <Plus className="size-3.5" />
            Add image or video
          </button>
          <button
            className={buttonClass}
            disabled={
              !canEdit ||
              !!running ||
              !view?.sources.some(
                (s) =>
                  s.status === "approved" &&
                  s.purpose !== "avoid" &&
                  s.asset?.mime_type.startsWith("image/"),
              )
            }
            onClick={() =>
              void perform("learn", () =>
                learnVisualReferences({
                  data: { workspaceId, idempotencyKey: crypto.randomUUID() },
                }),
              )
            }
          >
            Learn from references · {view?.profiles.length ? "125 credits" : "included"}
          </button>
        </div>
        {showLibrary && (
          <div className="ds-well rounded-[16px] p-3">
            {!library.length && (
              <p className="text-[12px] text-muted-foreground">
                Your saved images will appear here.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {library.map((asset) => (
                <button
                  key={asset.id}
                  className={cn(dsFocus, "min-w-0 overflow-hidden rounded-[12px] text-left")}
                  disabled={!canEdit}
                  onClick={() =>
                    void perform("library-add", () =>
                      addVisualReference({
                        data: {
                          workspaceId,
                          assetId: asset.id,
                          label: asset.name.slice(0, 120),
                          purpose,
                          notes,
                          campaign: campaign || undefined,
                          formats: format === "all" ? [] : [format as "image"],
                        },
                      }),
                    )
                  }
                >
                  <img
                    src={asset.thumbnailUrl || asset.url}
                    loading="lazy"
                    decoding="async"
                    alt={asset.name}
                    className="aspect-square w-full object-cover"
                  />
                  <span className="block truncate p-2 text-[11px]">{asset.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <details className="text-[12px] text-muted-foreground">
          <summary className={cn(dsFocus, "cursor-pointer rounded-full")}>
            Add an image link
          </summary>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              className={inputClass}
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="Public image URL"
              aria-label="Reference image link"
            />
            <button
              className={buttonClass}
              disabled={!canEdit || !sourceUrl.trim()}
              onClick={() => void upload()}
            >
              Add reference
            </button>
          </div>
        </details>
      </section>
      {draft && selected && (
        <section className="ds-tile space-y-4 p-4 sm:p-5" aria-label="Visual direction">
          <h4 className="text-[14px] font-semibold">Choose your direction</h4>
          {view?.activeId && (
            <button
              className={buttonClass}
              disabled={!canEdit}
              onClick={() =>
                void perform("manual", () =>
                  restoreManualVisualLook({
                    data: { workspaceId, expectedActiveId: view.activeId },
                  }),
                )
              }
            >
              Use manual look
            </button>
          )}
          <p className="text-[12px] text-muted-foreground">
            Layout previews use your references. Each creation gets imagery for its own brief.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {draft.directions.map((d, index) => (
              <button
                key={index}
                type="button"
                aria-pressed={draft.selected === index}
                disabled={!view?.canEdit}
                className={cn(
                  "ds-well min-w-0 rounded-[16px] p-3 text-left",
                  dsFocus,
                  draft.selected === index && "ring-1 ring-primary/50",
                )}
                onClick={() => setDraft({ ...draft, selected: index })}
              >
                <DirectionPreview
                  dna={dna}
                  profile={draft}
                  index={index}
                  sources={view?.sources ?? []}
                />
                <div className="mt-3 flex items-center justify-between gap-2 text-[12px] font-medium">
                  {d.name}
                  {draft.selected === index && <Check className="size-3.5 text-primary" />}
                </div>
                <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
                  {d.summary}
                </p>
              </button>
            ))}
          </div>
          <Field label="What to keep">
            <textarea
              className={inputClass}
              rows={2}
              value={selected.summary}
              maxLength={600}
              disabled={!view?.canEdit}
              onChange={(e) => update({ summary: e.target.value })}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Layout">
              <Segmented
                value={selected.layout}
                onChange={(v) => update({ layout: v ?? "editorial" })}
                options={[
                  { value: "editorial", label: "Editorial" },
                  { value: "bold", label: "Bold" },
                  { value: "soft", label: "Soft" },
                  { value: "frame", label: "Frame" },
                ]}
              />
            </Field>
            <Field label="Background">
              <Segmented
                value={selected.colorway}
                onChange={(v) => update({ colorway: v ?? "light" })}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                  { value: "brand", label: "Brand" },
                ]}
              />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>Keep this theme consistent</span>
            <Switch
              checked={selected.lockTheme}
              aria-label="Keep this theme consistent"
              disabled={!view?.canEdit}
              onCheckedChange={(lockTheme) => update({ lockTheme })}
            />
          </label>
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span>Use editable text and layouts</span>
            <Switch
              checked={selected.composed}
              aria-label="Use editable text and layouts"
              disabled={!view?.canEdit}
              onCheckedChange={(composed) => update({ composed })}
            />
          </label>
          <p className="text-[12px] text-muted-foreground">
            References guide the existing generator. Theme locks and editable layouts are optional.
          </p>
          {draft.warnings.map((w) => (
            <p key={w} className="text-[12px] text-muted-foreground">
              {w}
            </p>
          ))}
          <button
            className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
            disabled={!canEdit || !selected.summary.trim()}
            onClick={() =>
              void perform("approve", () =>
                saveVisualDirection({
                  data: {
                    workspaceId,
                    profile: draft,
                    expectedActiveId: view?.activeId ?? null,
                    confirm: true,
                  },
                }),
              )
            }
          >
            {busy === "approve" ? (
              <Spinner className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Use this direction
          </button>
          {active && (
            <p className="text-[12px] text-muted-foreground">
              Following {active.profile.directions[active.profile.selected]?.name}. New scans wait
              for your choice.
            </p>
          )}
        </section>
      )}
      {!!view?.profiles.filter((p) => p.status === "approved").length && (
        <details className="ds-tile p-4 sm:p-5">
          <summary className={cn(dsFocus, "cursor-pointer rounded-full text-[13px] font-medium")}>
            Direction history
          </summary>
          <div className="mt-3 space-y-2">
            {view.profiles
              .filter((p) => p.status === "approved")
              .map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-3 text-[12px]">
                  <span className="min-w-0 truncate">
                    {p.profile.directions[p.profile.selected]?.name} ·{" "}
                    {new Date(p.created_at).toLocaleDateString()}
                  </span>
                  <button
                    className={buttonClass}
                    disabled={!canEdit || p.id === view.activeId}
                    onClick={() =>
                      void perform("restore", () =>
                        saveVisualDirection({
                          data: {
                            workspaceId,
                            profile: p.profile,
                            expectedActiveId: view.activeId,
                            confirm: true,
                            restoreId: p.id,
                          },
                        }),
                      )
                    }
                  >
                    {p.id === view.activeId ? "Current" : "Restore"}
                  </button>
                </div>
              ))}
          </div>
        </details>
      )}
    </div>
  );
}

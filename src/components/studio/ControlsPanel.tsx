"use client";

import { useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { PLATFORMS } from "@/lib/social-platforms";
import { RATIOS, recommendedRatio } from "@/lib/studio/aspect";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { updateSession, type StudioSession } from "@/lib/studio/session-store";
import { FieldLabel, PlatformPicker, RatioPicker, Segmented } from "./studio-ui";

const INPUT =
  "h-9 w-full rounded-lg border border-input bg-surface-3 px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/55";

/** One-line description of the settings, for collapsed headers and summaries. */
export function describeControls(session: StudioSession): string {
  const c = session.controls;
  const format = STUDIO_FORMATS[session.type];
  const parts: string[] = [];
  if (session.type === "article") {
    parts.push(
      { short: "Short", standard: "Standard length", long: "In-depth" }[c.length ?? "standard"],
    );
  }
  if (session.type === "script") parts.push(`${c.durationSec ?? 30}s runtime`);
  if (session.type === "video")
    parts.push(`${c.durationSec ?? 6}s · ${c.videoResolution ?? "720P"}`);
  if (session.type === "carousel") parts.push(`${c.slideCount ?? 6} slides`);
  if (
    c.ratio &&
    format.ratios.length &&
    (format.media !== "optional-image" || c.includeImage || session.type === "carousel")
  ) {
    parts.push(`${RATIOS[c.ratio].label} ${c.ratio}`);
  }
  if (c.tone) parts.push(`Tone: ${c.tone}`);
  if (c.cta) parts.push("Custom CTA");
  return parts.join(" · ") || "Default settings";
}

/**
 * Where it goes stays visible; the shape and fine-tuning live in a settings
 * card that summarizes itself when collapsed, so the brief stays the focus.
 */
export function ControlsPanel({
  session,
  disabled,
}: {
  session: StudioSession;
  disabled?: boolean;
}) {
  const format = STUDIO_FORMATS[session.type];
  const c = session.controls;
  const [open, setOpen] = useState(false);
  const [ratioPinned, setRatioPinned] = useState(false);

  useEffect(() => {
    setRatioPinned(false);
    setOpen(false);
  }, [session.type]);

  const set = (patch: Partial<StudioControls>) =>
    updateSession(session.id, { controls: { ...c, ...patch } });
  const mediaKind = session.type === "video" ? "video" : "image";
  const recommended = format.ratios.length
    ? session.type === "carousel"
      ? "4:5"
      : recommendedRatio(c.platforms, mediaKind, format.ratios)
    : undefined;
  const showRatio =
    format.ratios.length > 0 &&
    (format.media !== "optional-image" || c.includeImage || session.type === "carousel");

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      {format.platforms.length ? (
        <div>
          <FieldLabel hint={format.multiPlatform ? "A native version for each" : "Pick one"}>
            {format.multiPlatform ? "Platforms" : "Platform"}
          </FieldLabel>
          <PlatformPicker
            platforms={format.platforms}
            value={c.platforms}
            multi={format.multiPlatform}
            onChange={(platforms) => {
              const next: Partial<StudioControls> = { platforms };
              if (!ratioPinned && format.ratios.length && session.type !== "carousel") {
                next.ratio = recommendedRatio(platforms, mediaKind, format.ratios);
              }
              set(next);
            }}
          />
        </div>
      ) : null}

      {format.media === "optional-image" ? (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-3 px-3.5 py-3">
          <span>
            <span className="block text-sm font-medium text-foreground">
              {session.type === "carousel" ? "Generate a cover visual" : "Add a generated visual"}
            </span>
            <span className="block text-xs text-muted-foreground">
              On-brand, sized for{" "}
              {c.platforms.length > 1
                ? "these platforms"
                : PLATFORMS[c.platforms[0] ?? "instagram"].label}{" "}
              · 1 image credit
            </span>
          </span>
          <Switch
            checked={!!c.includeImage}
            onCheckedChange={(v) => set({ includeImage: v })}
            aria-label="Add a generated visual"
          />
        </label>
      ) : null}

      <div className="rounded-xl border border-border bg-surface-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex w-full items-center gap-3 rounded-xl px-3.5 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
        >
          <SlidersHorizontal className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-foreground">Format settings</span>
            <span className="block truncate text-xs text-muted-foreground">
              {describeControls(session)}
            </span>
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open ? (
          <div className="space-y-5 border-t border-border px-3.5 pb-4 pt-4">
            {showRatio ? (
              <div>
                <FieldLabel
                  hint={
                    recommended
                      ? `Best for ${c.platforms.length > 1 ? "these platforms" : "this platform"}`
                      : undefined
                  }
                >
                  Size
                </FieldLabel>
                <RatioPicker
                  ratios={format.ratios}
                  value={c.ratio}
                  recommended={recommended}
                  onChange={(ratio) => {
                    setRatioPinned(ratio !== recommended);
                    set({ ratio });
                  }}
                />
              </div>
            ) : null}

            {session.type === "article" ? (
              <div>
                <FieldLabel>Length</FieldLabel>
                <Segmented
                  label="Length"
                  value={c.length ?? "standard"}
                  onChange={(length) => set({ length })}
                  options={[
                    { value: "short", label: "Short", hint: "~600 words" },
                    { value: "standard", label: "Standard", hint: "~1,100 words" },
                    { value: "long", label: "In-depth", hint: "~1,800 words" },
                  ]}
                />
              </div>
            ) : null}

            {session.type === "script" || session.type === "video" ? (
              <div>
                <FieldLabel
                  hint={session.type === "video" ? "Longer clips take longer to render" : undefined}
                >
                  {session.type === "video" ? "Length" : "Runtime"}
                </FieldLabel>
                <Segmented
                  label={session.type === "video" ? "Video length" : "Runtime"}
                  value={c.durationSec ?? (session.type === "video" ? 6 : 30)}
                  onChange={(durationSec) => set({ durationSec })}
                  options={(session.type === "video" ? [4, 6, 8] : [15, 30, 60]).map((v) => ({
                    value: v,
                    label: `${v}s`,
                  }))}
                />
              </div>
            ) : null}

            {session.type === "carousel" ? (
              <div>
                <FieldLabel hint={`${c.slideCount ?? 6} slides`}>Slides</FieldLabel>
                <input
                  type="range"
                  min={3}
                  max={10}
                  step={1}
                  value={c.slideCount ?? 6}
                  onChange={(e) => set({ slideCount: Number(e.target.value) })}
                  aria-label="Number of slides"
                  className="w-full accent-[hsl(var(--primary))]"
                />
              </div>
            ) : null}

            {session.type === "video" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel>Resolution</FieldLabel>
                  <Segmented
                    label="Resolution"
                    value={c.videoResolution ?? "720P"}
                    onChange={(videoResolution) => set({ videoResolution })}
                    options={[
                      { value: "480P", label: "480p" },
                      { value: "720P", label: "720p" },
                      { value: "1080P", label: "1080p" },
                    ]}
                  />
                </div>
                <label className="flex items-center justify-between gap-3 self-end rounded-lg bg-surface-2 px-3 py-2">
                  <span className="text-xs font-medium text-foreground">Generated audio</span>
                  <Switch
                    checked={c.audio ?? true}
                    onCheckedChange={(audio) => set({ audio })}
                    aria-label="Generated audio"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="studio-tone" hint="Optional">
                  Tone
                </FieldLabel>
                <input
                  id="studio-tone"
                  value={c.tone ?? ""}
                  onChange={(e) => set({ tone: e.target.value.slice(0, 80) || undefined })}
                  placeholder="Your Brand DNA voice"
                  className={INPUT}
                />
              </div>
              <div>
                <FieldLabel htmlFor="studio-cta" hint="Optional">
                  Call to action
                </FieldLabel>
                <input
                  id="studio-cta"
                  value={c.cta ?? ""}
                  onChange={(e) => set({ cta: e.target.value.slice(0, 140) || undefined })}
                  placeholder="e.g. Book a free consult"
                  className={INPUT}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </fieldset>
  );
}

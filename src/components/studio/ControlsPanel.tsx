"use client";

import { useEffect, useState } from "react";
import { ChevronDown, SlidersHorizontal } from "@/components/icons";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { RATIOS, recommendedRatio } from "@/lib/studio/aspect";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { STORY_THEMES, getStoryTheme } from "@/lib/stories/frames";
import { cleanMentions } from "@/lib/stories/placement";
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
    parts.push({ short: "Short", standard: "Medium length", long: "Long" }[c.length ?? "standard"]);
  }
  if (session.type === "script") parts.push(`${c.durationSec ?? 30} seconds`);
  if (session.type === "video")
    parts.push(
      `${c.durationSec ?? 6} seconds · ${{ "480P": "Basic", "720P": "HD", "1080P": "Full HD" }[c.videoResolution ?? "720P"]}`,
    );
  if (session.type === "carousel")
    parts.push(`${c.slideCount ?? 6} ${c.seamless ? "connected slides" : "slides"}`);
  if (session.type === "story") {
    parts.push(
      c.storyMode === "video"
        ? `Video · ${c.durationSec ?? 6} seconds`
        : `${c.frameCount ?? 3} ${(c.frameCount ?? 3) === 1 ? "frame" : "frames"}`,
    );
    const theme = getStoryTheme(c.storyTheme);
    if (theme) parts.push(theme.label);
  }
  if (
    c.ratio &&
    format.ratios.length &&
    (format.media !== "optional-image" || c.includeImage || session.type === "carousel")
  ) {
    parts.push(`${RATIOS[c.ratio].label} ${c.ratio}`);
  }
  if (c.tone) parts.push(`Voice: ${c.tone}`);
  if (c.cta) parts.push("Custom action");
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
    session.type !== "story" &&
    format.ratios.length > 0 &&
    (format.media !== "optional-image" || c.includeImage || session.type === "carousel");
  const storyVideo = session.type === "story" && c.storyMode === "video";

  return (
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-60">
      {format.platforms.length ? (
        <div>
          <FieldLabel>{format.multiPlatform ? "Platforms" : "Platform"}</FieldLabel>
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

      {session.type === "story" ? <StoryControls controls={c} set={set} /> : null}

      {format.media === "optional-image" && !storyVideo && !c.seamless ? (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-3 px-3.5 py-3">
          <span>
            <span className="block text-sm font-medium text-foreground">
              {session.type === "carousel"
                ? "Generate a cover visual"
                : session.type === "story"
                  ? "Add a photo behind the first frame"
                  : "Add a generated visual"}
            </span>
            <span className="block text-xs text-muted-foreground">Uses 1 image credit</span>
          </span>
          <Switch
            checked={!!c.includeImage}
            onCheckedChange={(v) => set({ includeImage: v })}
            aria-label="Add a generated visual"
          />
        </label>
      ) : null}

      {session.type === "carousel" ? (
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-3 px-3.5 py-3">
          <span>
            <span className="block text-sm font-medium text-foreground">Connected slides</span>
            <span className="block text-xs text-muted-foreground">
              One long picture that runs from slide to slide and loops back to the start
            </span>
          </span>
          <Switch
            checked={!!c.seamless}
            onCheckedChange={(v) => set({ seamless: v, ...(v ? { includeImage: false } : {}) })}
            aria-label="Connected slides"
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
            <span className="block text-sm font-medium text-foreground">More settings</span>
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
                    { value: "standard", label: "Medium", hint: "~1,100 words" },
                    { value: "long", label: "Long", hint: "~1,800 words" },
                  ]}
                />
              </div>
            ) : null}

            {session.type === "script" || session.type === "video" ? (
              <div>
                <FieldLabel
                  hint={session.type === "video" ? "Longer videos take longer" : undefined}
                >
                  Length
                </FieldLabel>
                <Segmented
                  label="Length"
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
                  <FieldLabel>Quality</FieldLabel>
                  <Segmented
                    label="Quality"
                    value={c.videoResolution ?? "720P"}
                    onChange={(videoResolution) => set({ videoResolution })}
                    options={[
                      { value: "480P", label: "Basic" },
                      { value: "720P", label: "HD" },
                      { value: "1080P", label: "Full HD" },
                    ]}
                  />
                </div>
                <label className="flex items-center justify-between gap-3 self-end rounded-lg bg-surface-2 px-3 py-2">
                  <span className="text-xs font-medium text-foreground">Sound</span>
                  <Switch
                    checked={c.audio ?? true}
                    onCheckedChange={(audio) => set({ audio })}
                    aria-label="Sound"
                  />
                </label>
              </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="studio-tone" hint="Optional">
                  Voice
                </FieldLabel>
                <input
                  id="studio-tone"
                  value={c.tone ?? ""}
                  onChange={(e) => set({ tone: e.target.value.slice(0, 80) || undefined })}
                  placeholder="e.g. Friendly and relaxed"
                  className={INPUT}
                />
              </div>
              <div>
                <FieldLabel htmlFor="studio-cta" hint="Optional">
                  What should people do?
                </FieldLabel>
                <input
                  id="studio-cta"
                  value={c.cta ?? ""}
                  onChange={(e) => set({ cta: e.target.value.slice(0, 140) || undefined })}
                  placeholder="e.g. Book a free call"
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

/** What only a Story asks: designed frames or a video, how many, and what about. */
function StoryControls({
  controls: c,
  set,
}: {
  controls: StudioControls;
  set: (patch: Partial<StudioControls>) => void;
}) {
  const video = c.storyMode === "video";
  const [mentions, setMentions] = useState((c.mentions ?? []).map((m) => `@${m}`).join(" "));
  return (
    <div className="space-y-4">
      <div>
        <FieldLabel>Made of</FieldLabel>
        <Segmented
          label="Made of"
          value={(video ? "video" : "frames") as "frames" | "video"}
          onChange={(storyMode) =>
            set({ storyMode, ...(storyMode === "video" ? { includeImage: false } : {}) })
          }
          options={[
            { value: "frames", label: "Designed frames", hint: "Your brand look" },
            { value: "video", label: "AI video", hint: "Uses a video credit" },
          ]}
        />
      </div>

      {video ? (
        <div>
          <FieldLabel>Length</FieldLabel>
          <Segmented
            label="Length"
            value={c.durationSec ?? 6}
            onChange={(durationSec) => set({ durationSec })}
            options={[4, 6, 8].map((v) => ({ value: v, label: `${v}s` }))}
          />
        </div>
      ) : (
        <div>
          <FieldLabel hint="Each frame shows for about 5 seconds">Frames</FieldLabel>
          <Segmented
            label="Frames"
            value={c.frameCount ?? 3}
            onChange={(frameCount) => set({ frameCount })}
            options={[1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }))}
          />
        </div>
      )}

      <div>
        <FieldLabel hint="Optional">About</FieldLabel>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="What the Story is about">
          {[
            { id: "", label: "Mellox picks" },
            ...STORY_THEMES.filter((t) => t.id !== "repurpose"),
          ].map((t) => {
            const on = (c.storyTheme ?? "") === t.id;
            return (
              <button
                key={t.id || "auto"}
                type="button"
                aria-pressed={on}
                title={"detail" in t ? t.detail : "Picked to differ from your last Stories"}
                onClick={() => set({ storyTheme: t.id || undefined })}
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  on
                    ? "border-primary-border bg-primary-surface text-foreground"
                    : "border-border bg-surface-3 text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {c.platforms.includes("instagram") ? (
        <div>
          <FieldLabel htmlFor="studio-mentions" hint="Instagram, optional">
            Mention accounts
          </FieldLabel>
          <input
            id="studio-mentions"
            value={mentions}
            onChange={(e) => setMentions(e.target.value.slice(0, 200))}
            onBlur={() => {
              const list = cleanMentions(mentions);
              setMentions(list.map((m) => `@${m}`).join(" "));
              set({ mentions: list.length ? list : undefined });
            }}
            placeholder="@partner @supplier"
            className={INPUT}
          />
        </div>
      ) : null}
    </div>
  );
}

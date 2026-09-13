"use client";

import { Camera, Mic, Type } from "@/components/icons";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { ScriptBeat, ScriptOutput } from "@/lib/studio/jobs";

/** "0–2s", "12-24s", "0:12–0:24" → [start, end] seconds, or null. */
function parseRange(time: string): [number, number] | null {
  const nums = [...time.matchAll(/(\d+):(\d{2})|(\d+(?:\.\d+)?)/g)].map((m) =>
    m[1] ? Number(m[1]) * 60 + Number(m[2]) : Number(m[3]),
  );
  return nums.length >= 2 && nums[1] > nums[0] ? [nums[0], nums[1]] : null;
}

function segments(beats: ScriptBeat[], total: number) {
  const ranges = beats.map((b) => parseRange(b.time));
  if (ranges.every(Boolean)) {
    const end = Math.max(total, ...ranges.map((r) => r![1]));
    return ranges.map((r) => (r![1] - r![0]) / end);
  }
  return beats.map(() => 1 / beats.length);
}

/**
 * A production storyboard: runtime at a glance, the hook called out, then
 * each beat with its shot, voiceover and on-screen text — ready to film.
 */
export function ScriptPreview({
  script,
  platform,
}: {
  script: ScriptOutput;
  platform?: PlatformId;
}) {
  const spec = platform ? PLATFORMS[platform] : null;
  const Icon = spec?.icon;
  const widths = segments(script.beats, script.durationSec);

  return (
    <div className="mx-auto w-full max-w-[680px] space-y-4">
      <section className="overflow-hidden rounded-2xl bg-surface-3 shadow-3 ring-1 ring-border/70">
        <header className="px-6 pb-5 pt-6">
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {Icon ? <Icon className="size-3.5" /> : null}
            {spec?.label ?? "Short-form"}
            <span aria-hidden>·</span>
            <span className="tabular-nums">~{script.durationSec}s</span>
            <span aria-hidden>·</span>
            {script.beats.length} beats
          </p>
          <h3 className="mt-2 text-balance text-xl font-semibold leading-snug tracking-tight text-foreground">
            {script.title}
          </h3>

          <div className="mt-5" aria-label="Runtime">
            <div className="flex h-2 gap-[3px]">
              {widths.map((w, i) => (
                <span
                  key={i}
                  title={script.beats[i]?.time}
                  className={i === 0 ? "rounded-full bg-primary" : "rounded-full bg-foreground/15"}
                  style={{ flexGrow: w, flexBasis: 0 }}
                />
              ))}
            </div>
            <div className="mt-1.5 flex justify-between font-mono text-[10px] tabular-nums text-muted-foreground">
              <span>0s</span>
              <span>{script.durationSec}s</span>
            </div>
          </div>
        </header>

        <div className="mx-6 rounded-xl bg-primary-surface p-4 ring-1 ring-primary-border">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-foreground/70">
            Hook · first 2 seconds
          </p>
          <p className="mt-1.5 text-pretty text-base font-medium leading-snug text-foreground">
            {script.hook}
          </p>
        </div>

        <ol className="px-6 pb-2 pt-6">
          {script.beats.map((beat, i) => (
            <li key={i} className="relative grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3 pb-5">
              {i < script.beats.length - 1 ? (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-[0.3rem] top-6 w-px bg-border"
                />
              ) : null}
              <span className="flex items-start gap-2 pt-0.5">
                <span
                  aria-hidden
                  className={
                    i === 0
                      ? "mt-1 size-2.5 shrink-0 rounded-full bg-primary"
                      : "mt-1 size-2.5 shrink-0 rounded-full bg-surface-3 ring-2 ring-border-strong"
                  }
                />
                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                  {beat.time}
                </span>
              </span>
              <div className="space-y-2.5 rounded-xl bg-surface-2/60 p-3.5 text-sm leading-relaxed">
                <p className="flex gap-2.5 text-foreground">
                  <Camera
                    className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
                    aria-label="Shot"
                  />
                  {beat.visual}
                </p>
                {beat.voiceover ? (
                  <p className="flex gap-2.5 text-foreground/85">
                    <Mic
                      className="mt-[3px] size-3.5 shrink-0 text-muted-foreground"
                      aria-label="Voiceover"
                    />
                    <span className="italic">“{beat.voiceover}”</span>
                  </p>
                ) : null}
                {beat.onScreen ? (
                  <p className="flex items-center gap-2.5">
                    <Type
                      className="size-3.5 shrink-0 text-muted-foreground"
                      aria-label="On-screen text"
                    />
                    <span className="inline-flex rounded-md bg-foreground px-2 py-0.5 text-xs font-semibold text-background">
                      {beat.onScreen}
                    </span>
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <footer className="border-t border-border/70 px-6 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Call to action
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">{script.cta}</p>
        </footer>
      </section>

      <section className="rounded-2xl bg-surface-3 p-5 shadow-1 ring-1 ring-border/70">
        <p className="ui-eyebrow">Caption</p>
        <p className="mt-2.5 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {script.caption}
        </p>
      </section>
    </div>
  );
}

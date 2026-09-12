"use client";

import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import type { ScriptOutput } from "@/lib/studio/jobs";

/** A production-ready shot list: hook, timed beats, CTA, and the caption. */
export function ScriptPreview({
  script,
  platform,
}: {
  script: ScriptOutput;
  platform?: PlatformId;
}) {
  return (
    <div className="mx-auto w-full max-w-[640px] space-y-4">
      <div className="rounded-2xl border border-border bg-surface-3 p-5 shadow-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="ui-eyebrow">
            {platform ? PLATFORMS[platform].label : "Short-form"} · ~{script.durationSec}s
          </p>
          <p className="text-xs text-muted-foreground">{script.beats.length} beats</p>
        </div>
        <h3 className="mt-2 text-lg font-semibold tracking-tight text-foreground">
          {script.title}
        </h3>
        <div className="mt-4 rounded-xl bg-primary-surface p-3 ring-1 ring-primary-border">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground/70">
            Hook · first 2 seconds
          </p>
          <p className="mt-1 text-sm font-medium leading-snug text-foreground">{script.hook}</p>
        </div>

        <ol className="mt-5 space-y-0">
          {script.beats.map((beat, i) => (
            <li
              key={i}
              className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-t border-border py-3 first:border-t-0"
            >
              <span className="pt-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                {beat.time}
              </span>
              <div className="space-y-1.5 text-sm leading-relaxed">
                <p className="text-foreground">{beat.visual}</p>
                {beat.voiceover ? (
                  <p className="border-l-2 border-primary/60 pl-3 italic text-foreground/85">
                    “{beat.voiceover}”
                  </p>
                ) : null}
                {beat.onScreen ? (
                  <p className="inline-flex rounded-md bg-surface-2 px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-border">
                    On screen: {beat.onScreen}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-2 border-t border-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Call to action
          </p>
          <p className="mt-1 text-sm text-foreground">{script.cta}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface-3 p-5">
        <p className="ui-eyebrow">Caption</p>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-foreground">
          {script.caption}
        </p>
      </div>
    </div>
  );
}

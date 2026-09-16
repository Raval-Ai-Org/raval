"use client";

import { AlertTriangle, Check, Image as ImageIcon, Mic, Video, Zap } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AllowanceView, ModelView, ReferenceImageView } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { ChipGroup, Field, formatUsd, Panel, StepActions } from "./ugc-ui";

export type RenderSettingsState = {
  model: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  referenceIds: string[];
};

const RATIO_LABEL: Record<string, string> = {
  "9:16": "9:16 Vertical",
  "1:1": "1:1 Square",
  "16:9": "16:9 Landscape",
  "4:3": "4:3",
  "3:4": "3:4 Portrait",
};

const TIER_LABEL: Record<ModelView["tier"], string> = {
  draft: "Draft",
  standard: "Best value",
  premium: "Premium",
};

export function allowedDurations(model: ModelView, imageCount: number): number[] {
  return imageCount > 0 && model.imageDurations ? model.imageDurations : model.durations;
}

export function usableRefs(model: ModelView, ids: string[]): string[] {
  return model.images ? ids.slice(0, model.images.max) : [];
}

/** Snap settings to what the model supports (mirrors coerceRenderSettings on the server). */
export function coerceSettings(
  model: ModelView,
  s: RenderSettingsState,
  preferRatio?: string,
): RenderSettingsState {
  const refs = usableRefs(model, s.referenceIds);
  const durations = allowedDurations(model, refs.length);
  const durationSec = durations.includes(s.durationSec)
    ? s.durationSec
    : durations.reduce((best, d) =>
        Math.abs(d - s.durationSec) < Math.abs(best - s.durationSec) ? d : best,
      );
  const wantRatio = preferRatio ?? s.aspectRatio;
  return {
    model: model.key,
    durationSec,
    aspectRatio: model.aspectRatios.includes(wantRatio) ? wantRatio : model.aspectRatios[0],
    resolution: model.resolutions.includes(s.resolution) ? s.resolution : model.defaultResolution,
    referenceIds: s.referenceIds,
  };
}

export function estimateUsd(model: ModelView, resolution: string, durationSec: number): number {
  const unit = model.pricing.usd[resolution] ?? 0;
  return model.pricing.unit === "video" ? unit : unit * durationSec;
}

export function GenerateStep({
  models,
  allowance,
  loadingModels,
  settings,
  references,
  generating,
  onChange,
  onBack,
  onGenerate,
}: {
  models: ModelView[];
  allowance: AllowanceView | null;
  loadingModels: boolean;
  settings: RenderSettingsState;
  references: ReferenceImageView[];
  generating: boolean;
  onChange: (next: RenderSettingsState) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  if (loadingModels) {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-36 rounded-2xl" />
        ))}
      </div>
    );
  }
  const model = models.find((m) => m.key === settings.model) ?? models[0];
  if (!model) {
    return (
      <Panel className="text-sm text-muted-foreground">
        No video models are enabled on this deployment.
      </Panel>
    );
  }

  const refs = usableRefs(model, settings.referenceIds);
  const durations = allowedDurations(model, refs.length);
  const usd = estimateUsd(model, settings.resolution, settings.durationSec);
  const remaining = allowance
    ? Math.max(0, allowance.videos.limit - allowance.videos.used - allowance.videos.held)
    : null;
  const spendLeft = allowance ? allowance.spend.monthlyLimitUsd - allowance.spend.monthUsd : null;
  const blockReason =
    remaining !== null && remaining < model.videoUnits
      ? "Your plan's monthly video allowance is used up."
      : spendLeft !== null && spendLeft < usd
        ? "This render would pass your plan's monthly AI spend limit."
        : allowance && allowance.activeRenders >= allowance.maxConcurrent
          ? `${allowance.activeRenders} renders are already in progress. Wait for one to finish.`
          : null;

  const toggleRef = (id: string) => {
    const has = settings.referenceIds.includes(id);
    const next = has
      ? settings.referenceIds.filter((r) => r !== id)
      : [...settings.referenceIds, id];
    onChange(coerceSettings(model, { ...settings, referenceIds: next }));
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Video model" className="grid gap-3 md:grid-cols-3">
        {models.map((m) => {
          const selected = m.key === model.key;
          const from = Math.min(...Object.values(m.pricing.usd));
          return (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(coerceSettings(m, settings))}
              className={cn(
                "flex flex-col gap-2 rounded-2xl bg-surface-2/70 p-4 text-left ring-1 transition-[box-shadow,background-color]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                selected ? "ring-2 ring-primary/80" : "ring-border/60 hover:bg-surface-2",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{m.displayName}</span>
                {selected ? (
                  <Check className="size-4 text-primary" aria-hidden />
                ) : (
                  <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {TIER_LABEL[m.tier]}
                  </span>
                )}
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{m.description}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Video className="size-3" aria-hidden />
                  {m.durations[0]}–{m.durations[m.durations.length - 1]}s
                </span>
                {m.nativeAudio ? (
                  <span className="inline-flex items-center gap-1">
                    <Mic className="size-3" aria-hidden /> Voice
                  </span>
                ) : null}
                {m.images ? (
                  <span className="inline-flex items-center gap-1">
                    <ImageIcon className="size-3" aria-hidden />
                    {m.images.mode === "references" ? `${m.images.max} photos` : "Opening photo"}
                  </span>
                ) : null}
                <span className="ml-auto tabular-nums">
                  from {formatUsd(m.pricing.unit === "video" ? from : from * m.durations[0])}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel className="space-y-4">
          <Field
            label="Duration"
            hint={
              refs.length && model.imageDurations ? "Fixed when product photos are used" : undefined
            }
          >
            <ChipGroup
              label="Duration"
              options={model.durations.map((d) => ({
                id: String(d),
                label: `${d}s`,
                disabled: !durations.includes(d),
              }))}
              value={String(settings.durationSec)}
              onChange={(v) => onChange({ ...settings, durationSec: Number(v) })}
              size="sm"
            />
          </Field>
          <Field label="Aspect ratio">
            <ChipGroup
              label="Aspect ratio"
              options={model.aspectRatios.map((r) => ({ id: r, label: RATIO_LABEL[r] ?? r }))}
              value={settings.aspectRatio}
              onChange={(v) => onChange({ ...settings, aspectRatio: v })}
              size="sm"
            />
          </Field>
          <Field label="Quality">
            <ChipGroup
              label="Quality"
              options={model.resolutions.map((r) => ({
                id: r,
                label: `${r} · ${formatUsd(estimateUsd(model, r, settings.durationSec))}`,
              }))}
              value={settings.resolution}
              onChange={(v) => onChange({ ...settings, resolution: v })}
              size="sm"
            />
          </Field>
          <Field
            label="Product photos"
            hint={
              model.images
                ? model.images.mode === "references"
                  ? `Up to ${model.images.max} keep the product accurate`
                  : "The first selected photo opens the video"
                : "This model doesn't take photos"
            }
          >
            {references.length ? (
              <ul className="flex flex-wrap gap-2">
                {references.map((ref) => {
                  const on = refs.includes(ref.assetId);
                  const selectable =
                    Boolean(model.images) && (on || refs.length < (model.images?.max ?? 0));
                  return (
                    <li key={ref.assetId}>
                      <button
                        type="button"
                        aria-pressed={on}
                        disabled={!selectable && !on}
                        onClick={() => toggleRef(ref.assetId)}
                        className={cn(
                          "relative block size-16 overflow-hidden rounded-xl ring-2 transition",
                          on ? "ring-primary" : "opacity-50 ring-transparent hover:opacity-80",
                          "disabled:cursor-not-allowed",
                        )}
                        aria-label={on ? `Don't use ${ref.filename}` : `Use ${ref.filename}`}
                      >
                        {ref.url ? (
                          <img src={ref.url} alt="" className="size-full object-cover" />
                        ) : null}
                        {on ? (
                          <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" aria-hidden />
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-start gap-2 text-xs text-muted-foreground">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                No product photos — the product will be generated from the description. Go back to
                Product to add one.
              </p>
            )}
          </Field>
        </Panel>

        <Panel className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Zap className="size-4 text-primary" aria-hidden /> This render
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Model</dt>
            <dd>{model.displayName}</dd>
            <dt className="text-muted-foreground">Video</dt>
            <dd className="tabular-nums">
              {settings.durationSec}s · {settings.aspectRatio} · {settings.resolution}
            </dd>
            <dt className="text-muted-foreground">Uses</dt>
            <dd className="tabular-nums">
              {model.videoUnits} video{model.videoUnits === 1 ? "" : "s"} of your plan
            </dd>
            <dt className="text-muted-foreground">Estimated cost</dt>
            <dd className="tabular-nums">{formatUsd(usd)}</dd>
          </dl>
          {allowance ? (
            <div className="space-y-1.5 rounded-xl bg-surface-3/50 p-3">
              <div className="flex justify-between text-[11.5px]">
                <span className="text-muted-foreground">Monthly videos</span>
                <span className="tabular-nums">
                  {allowance.videos.used + allowance.videos.held} / {allowance.videos.limit}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
                <div
                  className="h-full rounded-full bg-primary"
                  style={{
                    width: `${Math.min(100, ((allowance.videos.used + allowance.videos.held) / Math.max(1, allowance.videos.limit)) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {allowance.videos.held
                  ? `${allowance.videos.held} held for renders in progress. `
                  : ""}
                Failed renders are returned automatically.
              </p>
            </div>
          ) : null}
          {blockReason ? (
            <p role="alert" className="flex gap-1.5 text-xs text-danger">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {blockReason}
            </p>
          ) : null}
        </Panel>
      </div>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back to script
        </Button>
        <Button
          size="lg"
          onClick={onGenerate}
          loading={generating}
          disabled={Boolean(blockReason) || generating}
        >
          {generating ? null : <Video aria-hidden />}
          Generate video
        </Button>
      </StepActions>
    </div>
  );
}

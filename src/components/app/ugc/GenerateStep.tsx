"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Check,
  Clock,
  Cpu,
  Gauge,
  ImagePlus,
  Sparkles,
  Video,
  Wallet,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { AllowanceView, ModelView, ReferenceImageView } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  ChipGroup,
  ChoiceTile,
  CreatorSilhouette,
  Disclosure,
  formatUsd,
  motionPreset,
  Panel,
  PhoneFrame,
  RatioShape,
  SectionLabel,
  StepActions,
} from "./ugc-ui";

export type RenderSettingsState = {
  model: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  referenceIds: string[];
};

const RATIO_LABEL: Record<string, string> = {
  "9:16": "Vertical",
  "1:1": "Square",
  "16:9": "Wide",
  "4:3": "4:3",
  "3:4": "Portrait",
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
  hook,
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
  hook?: string;
  generating: boolean;
  onChange: (next: RenderSettingsState) => void;
  onBack: () => void;
  onGenerate: () => void;
}) {
  if (loadingModels) {
    return (
      <div className="grid gap-5 lg:grid-cols-[250px_1fr]">
        <Skeleton className="aspect-[9/16] rounded-[26px]" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[20px]" />
          ))}
        </div>
      </div>
    );
  }
  const model =
    models.find((m) => m.key === settings.model) ??
    models.find((m) => m.key === "seedance-2") ??
    models[0];
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
  const used = allowance ? allowance.videos.used + allowance.videos.held : 0;
  const remaining = allowance ? Math.max(0, allowance.videos.limit - used) : null;
  const spendLeft = allowance ? allowance.spend.monthlyLimitUsd - allowance.spend.monthUsd : null;
  const blockReason =
    remaining !== null && remaining < model.videoUnits
      ? "Your monthly videos are used up."
      : spendLeft !== null && spendLeft < usd
        ? "This would go over your monthly limit."
        : allowance && allowance.activeRenders >= allowance.maxConcurrent
          ? "Wait for a video in progress to finish."
          : null;
  const mainRef = references.find((r) => refs.includes(r.assetId));

  const toggleRef = (id: string) => {
    const has = settings.referenceIds.includes(id);
    const next = has
      ? settings.referenceIds.filter((r) => r !== id)
      : [...settings.referenceIds, id];
    onChange(coerceSettings(model, { ...settings, referenceIds: next }));
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        {/* Preview + summary */}
        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <div
            className={cn(
              "mx-auto",
              settings.aspectRatio === "16:9" || settings.aspectRatio === "4:3"
                ? "w-full max-w-[250px]"
                : settings.aspectRatio === "1:1"
                  ? "w-52"
                  : "w-44 lg:w-full lg:max-w-[200px]",
            )}
          >
            <PhoneFrame ratio={settings.aspectRatio}>
              {mainRef?.url ? (
                <motion.img
                  key={mainRef.assetId}
                  initial={{ opacity: 0, scale: 1.1 }}
                  animate={{ opacity: 0.55, scale: 1 }}
                  transition={motionPreset.slow}
                  src={mainRef.url}
                  alt=""
                  className="absolute inset-0 size-full! object-cover"
                />
              ) : null}
              <div className="absolute inset-0 bg-[radial-gradient(110%_60%_at_50%_0%,hsl(var(--primary)/0.3),transparent_60%)]" />
              <div className="absolute inset-x-[22%] bottom-0 top-[30%]">
                <CreatorSilhouette />
              </div>
              <span className="absolute left-2.5 top-4 rounded-full bg-black/55 px-2 py-0.5 text-[9.5px] font-medium tabular-nums backdrop-blur">
                {settings.durationSec}s · {settings.resolution}
              </span>
              {hook ? (
                <p className="absolute inset-x-2.5 bottom-3 rounded-lg bg-black/70 px-2 py-1.5 text-center text-[11px] font-semibold leading-snug backdrop-blur">
                  {hook}
                </p>
              ) : null}
            </PhoneFrame>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat icon={Clock} value={`${settings.durationSec}s`} label="Length" />
            <Stat icon={Wallet} value={formatUsd(usd)} label="Est. cost" />
            <Stat icon={Video} value={remaining === null ? "—" : String(remaining)} label="Left" />
          </div>
          {allowance ? (
            <div
              className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg-hover)]"
              aria-hidden
            >
              <motion.div
                className="h-full rounded-full bg-primary"
                initial={{ width: 0 }}
                animate={{
                  width: `${Math.min(100, (used / Math.max(1, allowance.videos.limit)) * 100)}%`,
                }}
                transition={motionPreset.slow}
              />
            </div>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-5">
          <div className="space-y-2.5">
            <SectionLabel icon={Video}>Shape</SectionLabel>
            <div
              role="radiogroup"
              aria-label="Shape"
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            >
              {model.aspectRatios.map((r) => (
                <ChoiceTile
                  key={r}
                  selected={settings.aspectRatio === r}
                  onSelect={() => onChange({ ...settings, aspectRatio: r })}
                  label={RATIO_LABEL[r] ?? r}
                  sublabel={r}
                  visual={<RatioShape ratio={r} />}
                />
              ))}
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2.5">
              <SectionLabel icon={Clock}>Length</SectionLabel>
              <ChipGroup
                label="Length"
                options={model.durations.map((d) => ({
                  id: String(d),
                  label: `${d}s`,
                  disabled: !durations.includes(d),
                }))}
                value={String(settings.durationSec)}
                onChange={(v) => onChange({ ...settings, durationSec: Number(v) })}
                size="sm"
              />
            </div>
            <div className="space-y-2.5">
              <SectionLabel icon={Gauge}>Quality</SectionLabel>
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
            </div>
          </div>

          <div className="space-y-2.5">
            <SectionLabel
              icon={ImagePlus}
              trailing={
                model.images ? (
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {refs.length}/{model.images.max}
                  </span>
                ) : null
              }
            >
              Photos
            </SectionLabel>
            {references.length ? (
              <ul className="flex flex-wrap gap-2">
                {references.map((ref) => {
                  const on = refs.includes(ref.assetId);
                  const selectable =
                    Boolean(model.images) && (on || refs.length < (model.images?.max ?? 0));
                  return (
                    <li key={ref.assetId}>
                      <motion.button
                        type="button"
                        whileTap={{ scale: 0.94 }}
                        aria-pressed={on}
                        disabled={!selectable && !on}
                        onClick={() => toggleRef(ref.assetId)}
                        className={cn(
                          "relative block size-16 overflow-hidden rounded-2xl ring-2 transition sm:size-[72px]",
                          on ? "ring-primary" : "opacity-45 ring-transparent hover:opacity-80",
                          "disabled:cursor-not-allowed",
                        )}
                        aria-label={on ? `Don't use ${ref.filename}` : `Use ${ref.filename}`}
                      >
                        {ref.url ? (
                          <img src={ref.url} alt="" className="size-full! object-cover" />
                        ) : null}
                        {on ? (
                          <span className="absolute right-1 top-1 grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Check className="size-3" aria-hidden />
                          </span>
                        ) : null}
                      </motion.button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="flex items-center gap-2 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-xs text-muted-foreground">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                No photos — add one in Product for an accurate look.
              </p>
            )}
            {!model.images && references.length ? (
              <p className="text-[11px] text-muted-foreground">This model doesn't use photos.</p>
            ) : null}
          </div>

          <Disclosure
            label="Model"
            icon={Cpu}
            badge={
              <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] text-muted-foreground">
                {settings.model === "auto" ? "Auto" : model.displayName}
              </span>
            }
          >
            <select
              aria-label="Model"
              value={settings.model}
              onChange={(event) => {
                const next = models.find((candidate) => candidate.key === event.target.value);
                if (next) onChange(coerceSettings(next, settings));
                else onChange({ ...settings, model: "auto" });
              }}
              className="h-9 w-full rounded-full border border-border bg-[var(--ds-well-bg)] px-3 text-sm sm:max-w-sm"
            >
              <option value="auto">Auto (recommended)</option>
              {models.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.displayName} · {TIER_LABEL[candidate.tier]}
                </option>
              ))}
            </select>
          </Disclosure>
        </div>
      </div>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back
        </Button>
        {blockReason ? (
          <span role="alert" className="flex items-center gap-1.5 text-xs text-danger">
            <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
            {blockReason}
          </span>
        ) : null}
        <Button
          size="lg"
          onClick={onGenerate}
          loading={generating}
          disabled={Boolean(blockReason) || generating}
        >
          {generating ? null : <Sparkles aria-hidden />}
          Create video
        </Button>
      </StepActions>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Clock; value: string; label: string }) {
  return (
    <div className="rounded-2xl bg-[var(--ds-well-bg)] px-1 py-2">
      <Icon className="mx-auto size-3.5 text-primary" aria-hidden />
      <p className="mt-1 text-sm font-semibold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

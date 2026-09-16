"use client";

import { useState } from "react";
import { Sparkles } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CREATOR_AGES,
  CREATOR_GENDERS,
  CREATOR_VIBES,
  CTA_PRESETS,
  FORMATS,
  LANGUAGES,
  OBJECTIVES,
  PLATFORMS,
  SETTINGS,
  TONES,
} from "@/lib/ugc/options";
import type { Brief, Product } from "@/lib/ugc/schemas";
import { ChipGroup, Field, Panel, StepActions } from "./ugc-ui";

export function BriefStep({
  initialBrief,
  product,
  hasConcepts,
  busy,
  onBack,
  onGenerate,
  onSkipToConcepts,
}: {
  initialBrief: Brief;
  product: Product;
  hasConcepts: boolean;
  busy: boolean;
  onBack: () => void;
  onGenerate: (brief: Brief) => void;
  onSkipToConcepts: (brief: Brief) => void;
}) {
  const [brief, setBrief] = useState<Brief>(initialBrief);
  const set = <K extends keyof Brief>(key: K, value: Brief[K]) =>
    setBrief((b) => ({ ...b, [key]: value }));
  const setCreator = <K extends keyof Brief["creator"]>(key: K, value: Brief["creator"][K]) =>
    setBrief((b) => ({ ...b, creator: { ...b.creator, [key]: value } }));
  const ctas = CTA_PRESETS[brief.objective];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel className="space-y-4">
          <h3 className="text-sm font-semibold">Campaign</h3>
          <Field label="Objective">
            <ChipGroup
              label="Objective"
              options={OBJECTIVES}
              value={brief.objective}
              onChange={(v) => set("objective", v)}
            />
          </Field>
          <Field label="Platform" hint="Sets the format and pacing">
            <ChipGroup
              label="Platform"
              options={PLATFORMS}
              value={brief.platform}
              onChange={(v) => set("platform", v)}
            />
          </Field>
          <Field
            label="Target audience"
            htmlFor="ugc-audience"
            hint={product.audienceHints.length ? "Suggested from the page" : undefined}
          >
            <Input
              id="ugc-audience"
              value={brief.audience}
              onChange={(e) => set("audience", e.target.value)}
              placeholder={product.audienceHints[0] ?? "e.g. busy parents who cook at home"}
            />
          </Field>
          <Field label="Call to action" htmlFor="ugc-cta">
            <div className="space-y-2">
              <Input
                id="ugc-cta"
                value={brief.cta}
                onChange={(e) => set("cta", e.target.value)}
                placeholder={ctas[0]}
              />
              <div className="flex flex-wrap gap-1.5">
                {ctas.map((cta) => (
                  <button
                    key={cta}
                    type="button"
                    onClick={() => set("cta", cta)}
                    className="rounded-full bg-surface-3/60 px-2.5 py-1 text-[11.5px] text-muted-foreground ring-1 ring-border/60 transition-colors hover:text-foreground"
                  >
                    {cta}
                  </button>
                ))}
              </div>
            </div>
          </Field>
        </Panel>

        <Panel className="space-y-4">
          <h3 className="text-sm font-semibold">Creative</h3>
          <Field label="UGC format">
            <ChipGroup
              label="UGC format"
              size="sm"
              options={FORMATS}
              value={brief.format}
              onChange={(v) => set("format", v)}
            />
          </Field>
          <Field label="Tone">
            <ChipGroup
              label="Tone"
              size="sm"
              options={TONES}
              value={brief.tone}
              onChange={(v) => set("tone", v)}
            />
          </Field>
          <Field label="Spoken language" htmlFor="ugc-language">
            <select
              id="ugc-language"
              value={brief.language}
              onChange={(e) => set("language", e.target.value as Brief["language"])}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </Panel>
      </div>

      <Panel className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold">Creator on camera</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            An AI-generated everyday creator — not a real person or influencer.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Presenter">
            <ChipGroup
              label="Presenter"
              size="sm"
              options={CREATOR_GENDERS}
              value={brief.creator.gender}
              onChange={(v) => setCreator("gender", v)}
            />
          </Field>
          <Field label="Age">
            <ChipGroup
              label="Age"
              size="sm"
              options={CREATOR_AGES}
              value={brief.creator.age}
              onChange={(v) => setCreator("age", v)}
            />
          </Field>
          <Field label="Energy">
            <ChipGroup
              label="Energy"
              size="sm"
              options={CREATOR_VIBES}
              value={brief.creator.vibe}
              onChange={(v) => setCreator("vibe", v)}
            />
          </Field>
          <Field label="Setting">
            <ChipGroup
              label="Setting"
              size="sm"
              options={SETTINGS}
              value={brief.creator.setting}
              onChange={(v) => setCreator("setting", v)}
            />
          </Field>
        </div>
        <Field label="Creative notes" htmlFor="ugc-notes" hint="Optional">
          <Textarea
            id="ugc-notes"
            rows={2}
            value={brief.instructions}
            onChange={(e) => set("instructions", e.target.value)}
            placeholder="Anything the ad must include or avoid — e.g. “show it fitting in a gym bag”, “don't mention price”."
          />
        </Field>
      </Panel>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back
        </Button>
        {hasConcepts ? (
          <Button variant="outline" onClick={() => onSkipToConcepts(brief)} disabled={busy}>
            Keep current concepts
          </Button>
        ) : null}
        <Button size="lg" onClick={() => onGenerate(brief)} loading={busy}>
          {busy ? null : <Sparkles aria-hidden />}
          {hasConcepts ? "Write new concepts" : "Write ad concepts"}
        </Button>
      </StepActions>
    </div>
  );
}

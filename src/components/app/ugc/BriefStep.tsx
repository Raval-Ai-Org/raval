"use client";

import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, Sparkles, Wand2 } from "@/components/icons";
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
import { ugcApi } from "@/lib/ugc/client";
import type { Brief, Product } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { ChipGroup, Field, Panel, StepActions } from "./ugc-ui";

export function BriefStep({
  workspaceId,
  projectId,
  initialBrief,
  product,
  hasConcepts,
  busy,
  onBack,
  onGenerate,
  onSkipToConcepts,
}: {
  workspaceId: string;
  projectId: string;
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
  const [writing, setWriting] = useState(false);
  const [written, setWritten] = useState<string | null>(null);
  const ours = !!written && brief.instructions.trim() === written.trim();

  const writeNotes = async () => {
    if (writing) return;
    const previous = brief.instructions;
    setWriting(true);
    try {
      const { notes } = await ugcApi.writeNotes(
        workspaceId,
        projectId,
        brief,
        ours ? undefined : brief.instructions,
      );
      set("instructions", notes);
      setWritten(notes);
      toast.success("Creative notes written", {
        action: { label: "Undo", onClick: () => set("instructions", previous) },
      });
    } catch (e) {
      toast.error("Couldn't write notes", {
        description: e instanceof Error ? e.message : "Please try again.",
      });
    } finally {
      setWriting(false);
    }
  };

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
          <Field label="Video style">
            <ChipGroup
              label="Video style"
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
          <div className="relative">
            <Textarea
              id="ugc-notes"
              rows={brief.instructions.length > 160 ? 8 : 3}
              value={brief.instructions}
              readOnly={writing}
              aria-busy={writing}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Anything the ad must include or avoid — e.g. “show it fitting in a gym bag”, “don't mention price”."
              className={cn("pb-12", writing && "opacity-50")}
            />
            <Button
              type="button"
              size="sm"
              onClick={() => void writeNotes()}
              loading={writing}
              className="absolute bottom-2 left-2 h-8 rounded-full px-3 text-xs"
            >
              {writing ? null : ours ? <RefreshCw aria-hidden /> : <Wand2 aria-hidden />}
              {writing
                ? "Writing…"
                : ours
                  ? "Try another"
                  : brief.instructions.trim()
                    ? "Improve it"
                    : "Write it for me"}
            </Button>
          </div>
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

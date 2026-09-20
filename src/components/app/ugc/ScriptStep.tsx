"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Trash2, Wand2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { checkScriptClaims } from "@/lib/ugc/grounding";
import { dialogueWordBudget, fitScenes, scriptWordCount } from "@/lib/ugc/prompt";
import type { Brief, Product, Scene, Script } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { Field, Panel, StepActions } from "./ugc-ui";

const QUICK_REWRITES = [
  "Make the opening more eye-catching",
  "Shorter and more natural, like a real person talking",
  "More energetic",
  "Make the product demo clearer",
  "Make the call to action clearer",
];

export function ScriptStep({
  initialScript,
  product,
  brief,
  durationSec,
  onDurationHint,
  rewriting,
  saving,
  onBack,
  onRewrite,
  onContinue,
}: {
  initialScript: Script;
  product: Product;
  brief: Brief;
  durationSec: number;
  onDurationHint?: string;
  rewriting: boolean;
  saving: boolean;
  onBack: (script: Script) => void;
  onRewrite: (script: Script, instruction: string) => void;
  onContinue: (script: Script) => void;
}) {
  const [script, setScript] = useState<Script>(initialScript);
  const [instruction, setInstruction] = useState("");

  const words = scriptWordCount(script, brief.language);
  const budget = dialogueWordBudget(durationSec);
  const warnings = useMemo(() => checkScriptClaims(script, product.facts), [script, product.facts]);
  const timed = useMemo(() => fitScenes(script.scenes, durationSec), [script.scenes, durationSec]);

  const setScene = (id: string, patch: Partial<Scene>) =>
    setScript((s) => ({
      ...s,
      scenes: s.scenes.map((sc) => (sc.id === id ? { ...sc, ...patch } : sc)),
    }));

  const addScene = () =>
    setScript((s) => {
      if (s.scenes.length >= 6) return s;
      const last = s.scenes[s.scenes.length - 1];
      const used = new Set(s.scenes.map((sc) => sc.id));
      let n = s.scenes.length + 1;
      while (used.has(`s${n}`)) n++;
      const start = last ? last.end : 0;
      return {
        ...s,
        scenes: [
          ...s.scenes,
          {
            id: `s${n}`,
            start,
            end: start + 2,
            shot: "",
            action: "",
            dialogue: "",
            productPlacement: "",
            caption: "",
          },
        ],
      };
    });

  const overBudget = words > budget + 3;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-3">
          <Panel className="space-y-3">
            <Field label="Hook (first line on camera)" htmlFor="ugc-hook">
              <Input
                id="ugc-hook"
                value={script.hook}
                onChange={(e) => setScript((s) => ({ ...s, hook: e.target.value }))}
              />
            </Field>
          </Panel>

          <ol className="space-y-3">
            {script.scenes.map((scene, i) => {
              const t = timed.find((x) => x.id === scene.id);
              const sceneWarnings = warnings.filter((w) => w.sceneId === scene.id);
              return (
                <li key={scene.id}>
                  <Panel className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="grid size-6 place-items-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="text-sm font-medium">
                          {i === 0
                            ? "Hook"
                            : i === script.scenes.length - 1
                              ? "Call to action"
                              : `Beat ${i + 1}`}
                        </span>
                        {t ? (
                          <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-[10.5px] tabular-nums text-muted-foreground">
                            {t.start}–{t.end}s
                          </span>
                        ) : null}
                      </div>
                      {script.scenes.length > 1 ? (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove scene ${i + 1}`}
                          onClick={() =>
                            setScript((s) => ({
                              ...s,
                              scenes: s.scenes.filter((x) => x.id !== scene.id),
                            }))
                          }
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      ) : null}
                    </div>
                    <Field
                      label="Spoken line"
                      htmlFor={`dlg-${scene.id}`}
                      hint={`${scene.dialogue.trim().split(/\s+/).filter(Boolean).length} words`}
                    >
                      <Textarea
                        id={`dlg-${scene.id}`}
                        rows={2}
                        value={scene.dialogue}
                        onChange={(e) => setScene(scene.id, { dialogue: e.target.value })}
                        placeholder="Exactly what the creator says (leave empty for no speech)"
                        className={cn(sceneWarnings.length && "border-danger/60")}
                      />
                    </Field>
                    {sceneWarnings.map((w) => (
                      <p key={w.claim + w.field} className="flex gap-1.5 text-[11.5px] text-danger">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                        {w.message}
                      </p>
                    ))}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Camera" htmlFor={`shot-${scene.id}`}>
                        <Input
                          id={`shot-${scene.id}`}
                          value={scene.shot}
                          onChange={(e) => setScene(scene.id, { shot: e.target.value })}
                          placeholder="Close selfie at arm's length"
                        />
                      </Field>
                      <Field label="Product on screen" htmlFor={`pp-${scene.id}`}>
                        <Input
                          id={`pp-${scene.id}`}
                          value={scene.productPlacement}
                          onChange={(e) => setScene(scene.id, { productPlacement: e.target.value })}
                          placeholder="Held up next to her face, label to camera"
                        />
                      </Field>
                    </div>
                    <Field label="Action" htmlFor={`act-${scene.id}`}>
                      <Input
                        id={`act-${scene.id}`}
                        value={scene.action}
                        onChange={(e) => setScene(scene.id, { action: e.target.value })}
                        placeholder="What the creator does"
                      />
                    </Field>
                    <Field
                      label="Caption idea"
                      htmlFor={`cap-${scene.id}`}
                      hint="Added in editing, not rendered"
                    >
                      <Input
                        id={`cap-${scene.id}`}
                        value={scene.caption}
                        onChange={(e) => setScene(scene.id, { caption: e.target.value })}
                      />
                    </Field>
                  </Panel>
                </li>
              );
            })}
          </ol>
          {script.scenes.length < 6 ? (
            <Button variant="outline" size="sm" onClick={addScene}>
              <Plus aria-hidden /> Add a beat
            </Button>
          ) : null}

          <Panel className="space-y-3">
            <Field label="Call to action" htmlFor="ugc-script-cta">
              <Input
                id="ugc-script-cta"
                value={script.cta}
                onChange={(e) => setScript((s) => ({ ...s, cta: e.target.value }))}
              />
            </Field>
            <Field label="Post caption" htmlFor="ugc-post-caption" hint="Published with the video">
              <Textarea
                id="ugc-post-caption"
                rows={3}
                value={script.postCaption}
                onChange={(e) => setScript((s) => ({ ...s, postCaption: e.target.value }))}
              />
            </Field>
            <Field label="Hashtags" htmlFor="ugc-hashtags" hint="Separate with spaces">
              <Input
                id="ugc-hashtags"
                value={script.hashtags.map((h) => `#${h}`).join(" ")}
                onChange={(e) =>
                  setScript((s) => ({
                    ...s,
                    hashtags: e.target.value
                      .split(/[\s,]+/)
                      .map((h) => h.replace(/^#/, ""))
                      .filter(Boolean)
                      .slice(0, 10),
                  }))
                }
              />
            </Field>
            {warnings
              .filter((w) => !w.sceneId)
              .map((w) => (
                <p key={w.claim + w.field} className="flex gap-1.5 text-[11.5px] text-danger">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {w.message}
                </p>
              ))}
          </Panel>
        </div>

        <aside className="space-y-3 lg:sticky lg:top-0 lg:self-start">
          <Panel className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium">Speaking time</span>
              <span
                className={cn(
                  "text-xs tabular-nums",
                  overBudget ? "text-danger" : "text-muted-foreground",
                )}
              >
                {words} / ~{budget} words
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-[--motion-duration-medium]",
                  overBudget ? "bg-danger" : "bg-primary",
                )}
                style={{ width: `${Math.min(100, (words / Math.max(budget, 1)) * 100)}%` }}
              />
            </div>
            <p className="text-[11.5px] text-muted-foreground">
              {overBudget
                ? `Too much to say naturally in ${durationSec}s. Trim it or pick a longer duration.`
                : `Fits a ${durationSec}-second clip.${onDurationHint ? ` ${onDurationHint}` : ""}`}
            </p>
          </Panel>

          <Panel className="space-y-2.5">
            <div className="flex items-center gap-2 text-xs font-medium">
              <Wand2 className="size-3.5 text-primary" aria-hidden /> Rewrite with AI
            </div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_REWRITES.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={rewriting}
                  onClick={() => onRewrite(script, q)}
                  className="rounded-full bg-surface-3/60 px-2.5 py-1 text-left text-[11.5px] text-muted-foreground ring-1 ring-border/60 transition-colors hover:text-foreground disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                if (instruction.trim()) onRewrite(script, instruction.trim());
              }}
            >
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder="Or say what to change…"
                className="h-9 min-w-0 flex-1"
                disabled={rewriting}
              />
              <Button
                type="submit"
                variant="secondary"
                loading={rewriting}
                disabled={!instruction.trim()}
                className="shrink-0"
              >
                Go
              </Button>
            </form>
          </Panel>

          <Panel className="space-y-1.5">
            <span className="text-xs font-medium">Facts this script can use</span>
            {product.facts.length ? (
              <ul className="max-h-48 space-y-1 overflow-y-auto text-[11.5px] text-muted-foreground">
                {product.facts.map((f) => (
                  <li key={f.id} className="leading-snug">
                    • {f.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11.5px] text-muted-foreground">
                No facts yet — the script must stay general.
              </p>
            )}
          </Panel>
        </aside>
      </div>

      <StepActions>
        <Button variant="ghost" onClick={() => onBack(script)} className="mr-auto">
          Back to concepts
        </Button>
        <Button
          size="lg"
          onClick={() => onContinue(script)}
          loading={saving}
          disabled={!script.hook.trim() || !script.scenes.length}
        >
          Continue to generate
        </Button>
      </StepActions>
    </div>
  );
}

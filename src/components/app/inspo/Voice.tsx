"use client";

// Inspo → Voice: how posts sound, plus example posts the brand loves
// (`dna.look.writing`, examples in `writing.examples`).
import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Plus, X } from "@/components/icons";
import { dsFocus, dsGhostBtn } from "@/components/app/surface/buttons";
import { ChipsInput, Segmented, ToneSlider } from "@/components/app/brain/brand/look/controls";
import type { BrandLookSpec, WritingStyle } from "@/lib/brand-look/spec";
import { addExample, EXAMPLE_CHARS, MAX_EXAMPLES } from "@/lib/inspo/look";
import { voiceSample } from "@/lib/inspo/voice-sample";
import { cn } from "@/lib/utils";
import { Block, EASE } from "./parts";
import { FineTune, Row } from "./PostLook";
import type { InspoHandlers, InspoView } from "./types";

export function Voice({
  view,
  spec,
  handlers,
}: {
  view: InspoView;
  spec: BrandLookSpec;
  handlers: InspoHandlers;
}) {
  const w = spec.writing ?? {};
  const tone = w.tone ?? {};
  const set = (patch: Partial<WritingStyle>) =>
    handlers.saveLook({ ...spec, writing: { ...spec.writing, ...patch } });
  const sample = voiceSample(w, view.dna.brandName);
  const [draft, setDraft] = React.useState("");
  const examples = w.examples ?? [];

  return (
    <div className="space-y-4">
      {/* The sample line rewrites itself as the sliders move. */}
      <div className="relative overflow-hidden rounded-[28px] bg-[var(--ds-tile-bg)] p-5 ring-1 ring-[var(--ds-tile-border)] sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground">
            {(view.dna.brandName || "M").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-h-[52px] min-w-0 flex-1 rounded-[18px] rounded-tl-[6px] bg-[var(--ds-well-bg)] px-4 py-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p
                key={sample}
                initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.28, ease: EASE }}
                className="text-[14.5px] leading-relaxed"
                data-testid="inspo-voice-sample"
              >
                {sample}
              </motion.p>
            </AnimatePresence>
          </div>
        </div>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <ToneSlider
            low="Formal"
            high="Casual"
            value={tone.casual}
            onChange={(casual) => set({ tone: { ...tone, casual } })}
          />
          <ToneSlider
            low="Serious"
            high="Playful"
            value={tone.playful}
            onChange={(playful) => set({ tone: { ...tone, playful } })}
          />
          <ToneSlider
            low="Short"
            high="Detailed"
            value={tone.detailed}
            onChange={(detailed) => set({ tone: { ...tone, detailed } })}
          />
          <ToneSlider
            low="Quiet"
            high="Bold"
            value={tone.bold}
            onChange={(bold) => set({ tone: { ...tone, bold } })}
          />
        </div>
      </div>

      <Block>
        <div className="grid gap-4 sm:grid-cols-3">
          <Row label="Emoji">
            <Segmented
              size="sm"
              value={w.emoji}
              onChange={(emoji) => set({ emoji })}
              options={[
                { value: "none", label: "None" },
                { value: "light", label: "✨" },
                { value: "heavy", label: "✨🔥🙌" },
              ]}
            />
          </Row>
          <Row label="Speak as">
            <Segmented
              size="sm"
              value={w.person}
              onChange={(person) => set({ person })}
              options={[
                { value: "we", label: "We" },
                { value: "i", label: "I" },
                { value: "you", label: "You" },
              ]}
            />
          </Row>
          <Row label="Hashtags">
            <Segmented
              size="sm"
              value={w.hashtags?.count == null ? undefined : String(Math.min(w.hashtags.count, 5))}
              onChange={(count) =>
                set({
                  hashtags: { ...w.hashtags, count: count == null ? undefined : Number(count) },
                })
              }
              options={[
                { value: "0", label: "0" },
                { value: "3", label: "3" },
                { value: "5", label: "5" },
              ]}
            />
          </Row>
        </div>
      </Block>

      <Block label="Posts you love">
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {examples.map((text) => (
              <motion.div
                key={text}
                layout
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="group relative rounded-[18px] bg-[var(--ds-well-bg)] py-3 pl-4 pr-10 text-[13px] leading-relaxed"
              >
                <p className="line-clamp-4 whitespace-pre-line">{text}</p>
                <button
                  type="button"
                  aria-label="Remove example"
                  onClick={() => set({ examples: examples.filter((e) => e !== text) })}
                  className={cn(
                    "absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full text-muted-foreground opacity-60 transition hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground group-hover:opacity-100",
                    dsFocus,
                  )}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
          {examples.length < MAX_EXAMPLES && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                const next = addExample(examples, draft);
                if (next !== examples) set({ examples: next });
                setDraft("");
              }}
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={EXAMPLE_CHARS}
                rows={3}
                placeholder="Paste a caption you wish you'd written"
                className={cn(dsFocus, "ds-well w-full resize-none px-4 py-3 text-[13.5px]")}
                aria-label="Example post"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </button>
            </form>
          )}
        </div>
      </Block>

      <FineTune>
        <Row label="Always include">
          <ChipsInput
            values={w.hashtags?.always ?? []}
            onChange={(always) => set({ hashtags: { ...w.hashtags, always } })}
            placeholder="yourbrand"
            prefix="#"
            max={6}
          />
        </Row>
        <Row label="Words to avoid">
          <ChipsInput
            values={w.bannedWords ?? []}
            onChange={(bannedWords) => set({ bannedWords })}
            placeholder="e.g. synergy, revolutionary"
            max={30}
          />
        </Row>
        <Row label="Favourite phrases">
          <ChipsInput
            values={w.signaturePhrases ?? []}
            onChange={(signaturePhrases) => set({ signaturePhrases })}
            placeholder="A line you always say"
            max={8}
          />
        </Row>
      </FineTune>
    </div>
  );
}

"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  BookOpen,
  Compass,
  Download,
  FacebookIcon,
  Gift,
  InstagramIcon,
  Lightbulb,
  Mail,
  Megaphone,
  MessageCircle,
  MousePointerClick,
  Play,
  RefreshCw,
  Repeat2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Star,
  Target,
  ThumbsUp,
  TiktokIcon,
  User,
  UserCircle2,
  Users,
  Video,
  Wand2,
  YoutubeIcon,
  Zap,
  type LucideIcon,
} from "@/components/icons";
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
  labelOf,
  type FormatId,
  type ObjectiveId,
  type PlatformId,
} from "@/lib/ugc/options";
import { ugcApi } from "@/lib/ugc/client";
import type { Brief, Product } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  ChipGroup,
  ChoiceTile,
  CreatorSilhouette,
  Disclosure,
  Field,
  Panel,
  PhoneFrame,
  RatioShape,
  SectionLabel,
  StepActions,
} from "./ugc-ui";

const PLATFORM_ICON: Record<PlatformId, LucideIcon> = {
  tiktok: TiktokIcon,
  reels: InstagramIcon,
  shorts: YoutubeIcon,
  facebook: FacebookIcon,
};

const PLATFORM_SHORT: Record<PlatformId, string> = {
  tiktok: "TikTok",
  reels: "Reels",
  shorts: "Shorts",
  facebook: "Facebook",
};

const OBJECTIVE_ICON: Record<ObjectiveId, LucideIcon> = {
  sales: ShoppingBag,
  conversion: MousePointerClick,
  awareness: Megaphone,
  engagement: MessageCircle,
  app_install: Download,
  lead_gen: Mail,
};

const FORMAT_ICON: Record<FormatId, LucideIcon> = {
  testimonial: Star,
  problem_solution: Lightbulb,
  demo: Play,
  unboxing: Gift,
  before_after: Repeat2,
  storytelling: BookOpen,
  founder: UserCircle2,
  review: ThumbsUp,
  educational: Compass,
  viral_hook: Zap,
};

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
  const platform = PLATFORMS.find((p) => p.id === brief.platform) ?? PLATFORMS[0];

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
      toast.success("Notes written", {
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
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <div className="space-y-2.5">
            <SectionLabel icon={Video}>Where</SectionLabel>
            <div role="radiogroup" aria-label="Platform" className="grid grid-cols-4 gap-2">
              {PLATFORMS.map((p) => {
                const Icon = PLATFORM_ICON[p.id];
                return (
                  <ChoiceTile
                    key={p.id}
                    selected={brief.platform === p.id}
                    onSelect={() => set("platform", p.id)}
                    label={PLATFORM_SHORT[p.id]}
                    sublabel={p.hint}
                    visual={<Icon className="size-5" />}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5">
            <SectionLabel icon={Target}>Goal</SectionLabel>
            <ChipGroup
              label="Goal"
              options={OBJECTIVES.map((o) => ({ ...o, icon: OBJECTIVE_ICON[o.id] }))}
              value={brief.objective}
              onChange={(v) => set("objective", v)}
            />
          </div>

          <div className="space-y-2.5">
            <SectionLabel icon={Sparkles}>Style</SectionLabel>
            <div
              role="radiogroup"
              aria-label="Video style"
              className="grid grid-cols-3 gap-2 sm:grid-cols-5"
            >
              {FORMATS.map((f) => {
                const Icon = FORMAT_ICON[f.id];
                return (
                  <ChoiceTile
                    key={f.id}
                    selected={brief.format === f.id}
                    onSelect={() => set("format", f.id)}
                    label={f.label}
                    sublabel={f.hint}
                    visual={<Icon className="size-5" />}
                  />
                );
              })}
            </div>
          </div>

          <div className="space-y-2.5">
            <SectionLabel icon={MessageCircle}>Tone</SectionLabel>
            <ChipGroup
              label="Tone"
              options={TONES}
              value={brief.tone}
              onChange={(v) => set("tone", v)}
            />
          </div>
        </div>

        {/* Creator preview */}
        <Panel className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <SectionLabel icon={User}>Creator</SectionLabel>
          <div className="mx-auto w-36">
            <PhoneFrame ratio={platform.aspectRatio}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${brief.creator.setting}-${brief.creator.vibe}-${brief.creator.gender}`}
                  initial={{ opacity: 0, scale: 1.05 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35 }}
                  className="absolute inset-0"
                >
                  <div className="absolute inset-0 bg-[radial-gradient(120%_70%_at_50%_0%,hsl(var(--primary)/0.35),transparent_60%)]" />
                  <div className="absolute inset-x-4 bottom-0 top-[22%]">
                    <CreatorSilhouette />
                  </div>
                  <span className="absolute left-2 top-4 rounded-full bg-black/55 px-2 py-0.5 text-[9px] font-medium backdrop-blur">
                    {labelOf(SETTINGS, brief.creator.setting)}
                  </span>
                  <span className="absolute bottom-2 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-primary px-2 py-0.5 text-[9px] font-semibold text-primary-foreground">
                    {labelOf(CREATOR_VIBES, brief.creator.vibe)}
                  </span>
                </motion.div>
              </AnimatePresence>
            </PhoneFrame>
          </div>
          <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
            <RatioShape ratio={platform.aspectRatio} className="text-primary" />
            {platform.aspectRatio} · {PLATFORM_SHORT[platform.id]}
          </div>
          <div className="space-y-3">
            <ChipGroup
              label="Presenter"
              size="sm"
              options={CREATOR_GENDERS}
              value={brief.creator.gender}
              onChange={(v) => setCreator("gender", v)}
            />
            <ChipGroup
              label="Age"
              size="sm"
              options={CREATOR_AGES}
              value={brief.creator.age}
              onChange={(v) => setCreator("age", v)}
            />
            <ChipGroup
              label="Energy"
              size="sm"
              options={CREATOR_VIBES}
              value={brief.creator.vibe}
              onChange={(v) => setCreator("vibe", v)}
            />
            <ChipGroup
              label="Setting"
              size="sm"
              options={SETTINGS}
              value={brief.creator.setting}
              onChange={(v) => setCreator("setting", v)}
            />
          </div>
        </Panel>
      </div>

      <Disclosure
        label="Audience, ending & notes"
        icon={SlidersHorizontal}
        badge={
          brief.audience ? (
            <span className="hidden max-w-[40%] items-center gap-1 truncate rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] text-muted-foreground sm:inline-flex">
              <Users className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{brief.audience}</span>
            </span>
          ) : null
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Who it's for" htmlFor="ugc-audience">
            <Input
              id="ugc-audience"
              value={brief.audience}
              onChange={(e) => set("audience", e.target.value)}
              placeholder={product.audienceHints[0] ?? "e.g. busy parents"}
            />
          </Field>
          <Field label="Language" htmlFor="ugc-language">
            <select
              id="ugc-language"
              value={brief.language}
              onChange={(e) => set("language", e.target.value as Brief["language"])}
              className="h-9 w-full rounded-full border border-input bg-[var(--ds-well-bg)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {LANGUAGES.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Ending line" htmlFor="ugc-cta">
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
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[11.5px] transition-colors",
                    brief.cta === cta
                      ? "bg-primary/15 text-foreground ring-1 ring-primary/50"
                      : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
                  )}
                >
                  {cta}
                </button>
              ))}
            </div>
          </div>
        </Field>
        <Field label="Notes" htmlFor="ugc-notes" hint="Optional">
          <div className="relative">
            <Textarea
              id="ugc-notes"
              rows={brief.instructions.length > 160 ? 7 : 3}
              value={brief.instructions}
              readOnly={writing}
              aria-busy={writing}
              onChange={(e) => set("instructions", e.target.value)}
              placeholder="Must include or avoid…"
              className={cn("pb-11", writing && "opacity-50")}
            />
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void writeNotes()}
              loading={writing}
              className="absolute bottom-2 right-2 h-7 px-2.5 text-[11.5px]"
            >
              {writing ? null : ours ? <RefreshCw aria-hidden /> : <Wand2 aria-hidden />}
              {writing
                ? "Writing…"
                : ours
                  ? "Another"
                  : brief.instructions.trim()
                    ? "Improve"
                    : "Write for me"}
            </Button>
          </div>
        </Field>
      </Disclosure>

      <StepActions>
        <Button variant="ghost" onClick={onBack} className="mr-auto">
          Back
        </Button>
        {hasConcepts ? (
          <Button variant="outline" onClick={() => onSkipToConcepts(brief)} disabled={busy}>
            Keep ideas
          </Button>
        ) : null}
        <Button size="lg" onClick={() => onGenerate(brief)} loading={busy}>
          {busy ? null : <Sparkles aria-hidden />}
          {hasConcepts ? "New ideas" : "Get ideas"}
        </Button>
      </StepActions>
    </div>
  );
}

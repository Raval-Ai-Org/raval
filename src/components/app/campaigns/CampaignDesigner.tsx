"use client";

// Designing a campaign, one short step at a time: what kind, the basics and
// the goal, what the person already has (products, photos, clips, facts), where
// and how often, then the whole plan drawn for free by the skeleton. Writing
// the ideas is the one paid click, and its price is on the button.
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Image as ImageIcon,
  Plus,
  Sparkles,
  Spinner,
  Upload,
  Video,
  X,
} from "@/components/icons";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { addDaysYmd } from "@/lib/autopilot/time";
import {
  CAMPAIGN_GOAL_KINDS,
  CAMPAIGN_PACES,
  GOAL_LABELS,
  MAX_CAMPAIGN_MEDIA,
  MAX_CAMPAIGN_WEEKS,
  PACE_LABELS,
  type CampaignBrief,
  type CampaignBriefInput,
  type CampaignMedia,
  type CampaignPiece,
  type MediaRole,
  type PlatformId,
} from "@/lib/campaigns/contracts";
import { isShareableLink, linkRule } from "@/lib/campaigns/links";
import { assignMedia, settleFormats } from "@/lib/campaigns/media";
import { phaseOf, playbookById, type Playbook } from "@/lib/campaigns/playbooks";
import { buildCampaignSkeleton, takenBy, type TakenSlot } from "@/lib/campaigns/skeleton";
import { isStoryPlatform } from "@/lib/stories/placement";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Gallery } from "./Gallery";
import { PlatformLogoGrid } from "@/components/studio/studio-ui";
import { ChannelMark, FormatChip, kindIcon, shortDate } from "./kit";
import type { CampaignsHandlers, CampaignsMode, CampaignsView } from "./types";

const STEPS = ["Kind", "Basics", "What you have", "Channels", "Plan"] as const;
const CHANNELS: PlatformId[] = [
  "instagram",
  "facebook",
  "linkedin",
  "tiktok",
  "twitter",
  "threads",
  "youtube",
];
const ROLE_LABELS: Record<MediaRole, string> = {
  hero: "Main photo",
  detail: "Close-up",
  people: "People",
  place: "Place",
  event: "At the event",
  any: "Any",
};

const input =
  "h-10 w-full rounded-2xl border border-border/70 bg-[var(--ds-tile-bg)] px-3.5 text-[13.5px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/50 focus:ring-2 focus:ring-primary/20";
const area = cn(input, "h-auto min-h-[84px] resize-y py-2.5 leading-relaxed");

function freshBrief(
  playbook: Playbook | null,
  today: string,
  timezone: string,
  prefill?: Partial<CampaignBriefInput> | null,
): CampaignBrief {
  const startsOn = addDaysYmd(today, 1);
  const base: CampaignBrief = {
    type: playbook?.id ?? "",
    name: "",
    about: "",
    keyMessage: "",
    offer: "",
    facts: [],
    keyDate: playbook?.needs.keyDate
      ? addDaysYmd(today, Math.max(7, (playbook.defaultWeeks - 1) * 7))
      : null,
    startsOn,
    weeks: playbook?.defaultWeeks ?? 3,
    channels: ["instagram"],
    pace: playbook?.pace ?? "steady",
    stories: true,
    timezone,
    hashtag: "",
    tone: "",
    goal: {
      kind: playbook?.goal ?? "engagement",
      target: null,
      link: null,
      linkLabel: "",
      count: null,
      countAt: null,
    },
    productIds: [],
    media: [],
  };
  if (!prefill) return base;
  return {
    ...base,
    ...(prefill as Partial<CampaignBrief>),
    type: playbook?.id ?? base.type,
    facts: (prefill.facts as string[] | undefined) ?? base.facts,
    media: (prefill.media as CampaignMedia[] | undefined) ?? base.media,
    goal: { ...base.goal, ...(prefill.goal ?? {}) } as CampaignBrief["goal"],
  };
}

export function CampaignDesigner({
  view,
  mode,
  handlers,
}: {
  view: CampaignsView;
  mode: Extract<CampaignsMode, { kind: "new" }>;
  handlers: CampaignsHandlers;
}) {
  const editing = mode.editId && view.selected?.id === mode.editId ? view.selected : null;
  const [brief, setBrief] = useState<CampaignBrief>(() =>
    editing
      ? editing.brief
      : freshBrief(playbookById(mode.type), view.today, view.timezone, mode.prefill),
  );
  const [step, setStep] = useState(() => (editing || mode.type ? 1 : 0));
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState<null | "write" | "save" | "plan" | "upload">(null);
  const playbook = playbookById(brief.type);

  const set = (patch: Partial<CampaignBrief>) => setBrief((b) => ({ ...b, ...patch }));
  const setGoal = (patch: Partial<CampaignBrief["goal"]>) =>
    setBrief((b) => ({ ...b, goal: { ...b.goal, ...patch } }));

  const pick = (type: string) => {
    const next = playbookById(type);
    setBrief((b) => {
      const fresh = freshBrief(next, view.today, view.timezone);
      // Keep what the person already typed; take the new kind's shape.
      return {
        ...fresh,
        name: b.name,
        about: b.about,
        keyMessage: b.keyMessage,
        offer: b.offer,
        facts: b.facts,
        channels: b.channels,
        media: b.media,
        productIds: b.productIds,
        goal: {
          ...fresh.goal,
          link: b.goal.link,
          linkLabel: b.goal.linkLabel,
          target: b.goal.target,
        },
      };
    });
    go(1);
  };

  const go = (next: number) => {
    setDir(next > step ? 1 : -1);
    setStep(Math.max(0, Math.min(STEPS.length - 1, next)));
  };

  const linkBad = !!brief.goal.link && !isShareableLink(brief.goal.link);
  const blocked: (string | null)[] = [
    playbook ? null : "Pick a kind of campaign",
    !brief.name.trim()
      ? "Give it a name"
      : linkBad
        ? "The link must be a full https:// address"
        : playbook?.needs.keyDate && !brief.keyDate
          ? "Pick the big day"
          : null,
    null,
    brief.channels.length ? null : "Pick at least one channel",
    null,
  ];

  const save = async (andPlan: boolean) => {
    setBusy(andPlan ? "plan" : "save");
    try {
      const saved = await handlers.save(
        { ...brief, goal: { ...brief.goal, link: brief.goal.link?.trim() || null } },
        editing?.id ?? null,
      );
      if (!saved) return;
      handlers.go({ kind: "campaign", id: saved.id });
      if (andPlan) await handlers.plan(saved.id);
    } finally {
      setBusy(null);
    }
  };

  const write = async () => {
    if (!playbook) return;
    setBusy("write");
    try {
      const out = await handlers.write({
        type: playbook.id,
        name: brief.name || undefined,
        about: brief.about || undefined,
        productIds: brief.productIds,
      });
      if (out) {
        setBrief((b) => ({
          ...b,
          name: b.name || out.name,
          about: out.about || b.about,
          keyMessage: out.keyMessage || b.keyMessage,
        }));
      }
    } finally {
      setBusy(null);
    }
  };

  const Icon = kindIcon(playbook?.icon);
  const last = step === STEPS.length - 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Top bar */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/50 px-3 py-2.5 @3xl/campaigns:px-6">
        <button
          type="button"
          aria-label="Back to campaigns"
          onClick={() =>
            handlers.go(editing ? { kind: "campaign", id: editing.id } : { kind: "home" })
          }
          className={dsIconBtn}
        >
          <ArrowLeft className="size-4" />
        </button>
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">
            {editing
              ? `Edit ${editing.name}`
              : brief.name || (playbook ? `New ${playbook.label.toLowerCase()}` : "New campaign")}
          </p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
        </div>
        {/* Step dots */}
        <ol className="hidden items-center gap-1 @2xl/campaigns:flex" aria-label="Steps">
          {STEPS.map((s, i) => {
            const reachable = blocked.slice(0, i).every((b) => !b);
            return (
              <li key={s}>
                <button
                  type="button"
                  disabled={!reachable}
                  onClick={() => go(i)}
                  className={cn(
                    "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium transition-colors disabled:opacity-40",
                    i === step
                      ? "bg-foreground text-background"
                      : i < step
                        ? "text-foreground/80 hover:bg-[var(--ds-well-bg)]"
                        : "text-muted-foreground hover:bg-[var(--ds-well-bg)]",
                  )}
                >
                  {i < step ? (
                    <Check className="size-3" />
                  ) : (
                    <span className="tabular-nums">{i + 1}</span>
                  )}
                  {s}
                </button>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Progress line */}
      <div className="h-0.5 shrink-0 bg-[var(--ds-well-bg)]">
        <motion.div
          className="h-full bg-primary shadow-[0_0_8px_hsl(var(--primary)/0.7)]"
          animate={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          transition={{ duration: duration.slow, ease: ease.emphasized }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-4 py-6 @3xl/campaigns:px-8">
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
            >
              {step === 0 && (
                <StepIntro
                  title="What are you planning?"
                  body="Pick the closest. Each kind has its own steps, from the first tease to the follow-up."
                >
                  <Gallery onPick={pick} selected={brief.type || null} />
                </StepIntro>
              )}
              {step === 1 && playbook && (
                <Basics
                  playbook={playbook}
                  brief={brief}
                  set={set}
                  setGoal={setGoal}
                  linkBad={linkBad}
                />
              )}
              {step === 2 && playbook && (
                <Have
                  playbook={playbook}
                  brief={brief}
                  set={set}
                  view={view}
                  handlers={handlers}
                  busy={busy}
                  setBusy={setBusy}
                  onWrite={write}
                />
              )}
              {step === 3 && <Channels brief={brief} set={set} />}
              {step === 4 && playbook && <Preview playbook={playbook} brief={brief} view={view} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 bg-background/80 px-4 py-3 backdrop-blur @3xl/campaigns:px-6">
        <p className="min-w-0 text-[12px] text-muted-foreground">
          {blocked[step] ??
            (last
              ? view.home.canPlan
                ? "Each post is charged at its usual price when it's made."
                : "Campaign plans are on Growth and up."
              : "")}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => go(step - 1)}
              className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
            >
              Back
            </button>
          )}
          {last ? (
            <>
              <button
                type="button"
                data-testid="save-draft"
                disabled={!!busy}
                onClick={() => void save(false)}
                className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
              >
                {busy === "save" ? <Spinner className="size-4 animate-spin" /> : null}
                Save draft
              </button>
              <button
                type="button"
                data-testid="write-plan"
                disabled={!!busy}
                onClick={() => void save(true)}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                {busy === "plan" ? (
                  <Spinner className="size-4 animate-spin" />
                ) : (
                  <Sparkles className="size-4" />
                )}
                Write the plan
                <span
                  data-slot="cost-chip"
                  className="rounded-full px-1.5 py-0.5 text-[11px] tabular-nums"
                >
                  {view.home.price.plan} credits
                </span>
              </button>
            </>
          ) : (
            step > 0 && (
              <button
                type="button"
                data-testid="next-step"
                disabled={!!blocked[step]}
                onClick={() => go(step + 1)}
                className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
              >
                Next
                <ArrowRight className="size-4" />
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function StepIntro({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h2>
      {body && (
        <p className="mt-1 max-w-xl text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
      )}
      <div className="mt-6">{children}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className="mb-1.5 block text-[12.5px] font-medium text-foreground/85">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Chip({
  on,
  onClick,
  children,
  testId,
}: {
  on: boolean;
  onClick(): void;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-medium ring-1 transition-all active:scale-[0.97]",
        on
          ? "bg-primary/15 text-foreground ring-primary/50"
          : "bg-[var(--ds-tile-bg)] text-foreground/75 ring-border/70 hover:text-foreground hover:ring-foreground/20",
      )}
    >
      {on && <Check className="size-3.5 text-primary" />}
      {children}
    </button>
  );
}

/* ───────────────────────── step 2: basics ───────────────────────── */

function Basics({
  playbook,
  brief,
  set,
  setGoal,
  linkBad,
}: {
  playbook: Playbook;
  brief: CampaignBrief;
  set(p: Partial<CampaignBrief>): void;
  setGoal(p: Partial<CampaignBrief["goal"]>): void;
  linkBad: boolean;
}) {
  return (
    <StepIntro title="The basics" body="A name, when it happens, and what it's for.">
      <div className="grid gap-5 @2xl/campaigns:grid-cols-2">
        <Field label="Name" className="@2xl/campaigns:col-span-2">
          <input
            className={input}
            data-testid="campaign-name"
            value={brief.name}
            maxLength={80}
            placeholder={`e.g. ${playbook.id === "event" ? "Spring open day" : playbook.id === "seasonal" ? "Winter warmers" : "The new range"}`}
            onChange={(e) => set({ name: e.target.value })}
          />
        </Field>
        <Field label="Starts">
          <input
            type="date"
            className={input}
            value={brief.startsOn}
            onChange={(e) => e.target.value && set({ startsOn: e.target.value })}
          />
        </Field>
        {playbook.needs.keyDate ? (
          <Field
            label={
              playbook.group === "launch" || playbook.id === "event" ? "The big day" : "Main day"
            }
            hint="Posts build up to it, then follow up after."
          >
            <input
              type="date"
              className={input}
              value={brief.keyDate ?? ""}
              min={brief.startsOn}
              onChange={(e) => set({ keyDate: e.target.value || null })}
            />
          </Field>
        ) : (
          <Field label="How long">
            <select
              className={input}
              value={brief.weeks}
              onChange={(e) => set({ weeks: Number(e.target.value) })}
            >
              {Array.from({ length: MAX_CAMPAIGN_WEEKS }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  {w} week{w === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <div className="mt-8">
        <p className="mb-2 text-[12.5px] font-medium text-foreground/85">What should it get you?</p>
        <div className="flex flex-wrap gap-2">
          {CAMPAIGN_GOAL_KINDS.map((k) => (
            <Chip key={k} on={brief.goal.kind === k} onClick={() => setGoal({ kind: k })}>
              {GOAL_LABELS[k]}
            </Chip>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-5 @2xl/campaigns:grid-cols-[1fr_2fr]">
        <Field label="Your target" hint="Optional. You enter the real number as it comes in.">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            className={input}
            value={brief.goal.target ?? ""}
            placeholder="e.g. 1000"
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value));
              setGoal({ target: e.target.value && n > 0 ? Math.min(n, 10_000_000) : null });
            }}
          />
        </Field>
        <Field
          label="Link"
          hint={
            linkBad
              ? "Use the full address, starting with https://"
              : "Your form, shop or booking page. It goes into captions where links work."
          }
        >
          <input
            type="url"
            inputMode="url"
            data-testid="campaign-link"
            className={cn(
              input,
              linkBad &&
                "border-destructive/60 focus:border-destructive/60 focus:ring-destructive/15",
            )}
            value={brief.goal.link ?? ""}
            placeholder="https://"
            onChange={(e) => setGoal({ link: e.target.value || null })}
          />
        </Field>
      </div>
    </StepIntro>
  );
}

/* ───────────────────────── step 3: what you have ───────────────────────── */

function Have({
  playbook,
  brief,
  set,
  view,
  handlers,
  busy,
  setBusy,
  onWrite,
}: {
  playbook: Playbook;
  brief: CampaignBrief;
  set(p: Partial<CampaignBrief>): void;
  view: CampaignsView;
  handlers: CampaignsHandlers;
  busy: string | null;
  setBusy(b: null | "upload"): void;
  onWrite(): void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const room = MAX_CAMPAIGN_MEDIA - brief.media.length;

  const add = async (files: File[]) => {
    const ok = files
      .filter((f) => f.type.startsWith("image/") || f.type.startsWith("video/"))
      .slice(0, room);
    if (!ok.length) return;
    setBusy("upload");
    try {
      const added = await handlers.upload(ok);
      if (added.length) set({ media: [...brief.media, ...added].slice(0, MAX_CAMPAIGN_MEDIA) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <StepIntro
      title="What you have"
      body="Give Mellox what it should work with once. It places your photos and clips across the campaign: close-ups to tease, the main photo for the reveal, the event shots for the recap."
    >
      <div className="space-y-8">
        <div className="ds-tile flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">Not sure what to write?</p>
            <p className="text-[12.5px] text-muted-foreground">
              Mellox drafts it from your Brand DNA and products. You check it.
            </p>
          </div>
          <button
            type="button"
            data-testid="write-for-me"
            disabled={!!busy}
            onClick={onWrite}
            className={cn(dsGhostBtn, "h-9 px-4 text-[13px]")}
          >
            {busy === "write" ? (
              <Spinner className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4 text-primary" />
            )}
            Write it for me
            <span className="rounded-full bg-[var(--ds-well-bg)] px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {view.home.price.write} credits
            </span>
          </button>
        </div>

        <div className="grid gap-5 @2xl/campaigns:grid-cols-2">
          <Field label="What it's about" className="@2xl/campaigns:col-span-2">
            <textarea
              className={area}
              value={brief.about}
              maxLength={800}
              placeholder="In your words: what's happening and who it's for."
              onChange={(e) => set({ about: e.target.value })}
            />
          </Field>
          <Field label="The one thing to remember">
            <input
              className={input}
              value={brief.keyMessage}
              maxLength={240}
              onChange={(e) => set({ keyMessage: e.target.value })}
            />
          </Field>
          <Field label="Offer" hint="Only if there is one, with its real terms.">
            <input
              className={input}
              value={brief.offer}
              maxLength={240}
              placeholder="e.g. 20% off until 30 Nov"
              onChange={(e) => set({ offer: e.target.value })}
            />
          </Field>
          <Field
            label="Facts posts may use"
            hint="One per line: speakers, venue, price, what's new. Posts use nothing else."
            className="@2xl/campaigns:col-span-2"
          >
            <textarea
              className={area}
              value={brief.facts.join("\n")}
              onChange={(e) =>
                set({
                  facts: e.target.value
                    .split("\n")
                    .map((f) => f.slice(0, 200))
                    .slice(0, 12),
                })
              }
              onBlur={() => set({ facts: brief.facts.map((f) => f.trim()).filter(Boolean) })}
            />
          </Field>
        </div>

        {view.products.length > 0 && (
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-foreground/85">
              Products {playbook.needs.product ? "to feature" : "(optional)"}
              <span className="ml-1 font-normal text-muted-foreground">· up to 3</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {view.products.map((p) => {
                const on = brief.productIds.includes(p.id);
                return (
                  <Chip
                    key={p.id}
                    on={on}
                    onClick={() =>
                      set({
                        productIds: on
                          ? brief.productIds.filter((id) => id !== p.id)
                          : [...brief.productIds, p.id].slice(-3),
                      })
                    }
                  >
                    {p.thumb && (
                      <img
                        src={p.thumb}
                        alt=""
                        className="-ml-1.5 size-6 rounded-full object-cover"
                      />
                    )}
                    <span className="max-w-[160px] truncate">{p.name}</span>
                  </Chip>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-foreground/85">
            Photos and clips
            <span className="ml-1 font-normal text-muted-foreground">
              · {brief.media.length} of {MAX_CAMPAIGN_MEDIA}
            </span>
          </p>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void add(Array.from(e.dataTransfer.files));
            }}
            className={cn(
              "rounded-[20px] border border-dashed p-3 transition-colors",
              drag ? "border-primary/60 bg-primary/5" : "border-border/80",
            )}
          >
            <div className="grid grid-cols-3 gap-2 @md/campaigns:grid-cols-4 @3xl/campaigns:grid-cols-6">
              <AnimatePresence initial={false}>
                {brief.media.map((m) => (
                  <motion.div
                    key={m.assetId}
                    layout
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.92 }}
                    transition={{ duration: duration.base, ease: ease.emphasized }}
                    className="group relative overflow-hidden rounded-2xl bg-[var(--ds-well-bg)]"
                  >
                    <div className="aspect-square">
                      {view.mediaUrls[m.assetId] ? (
                        m.kind === "video" ? (
                          <video
                            src={view.mediaUrls[m.assetId]}
                            muted
                            playsInline
                            className="size-full object-cover"
                          />
                        ) : (
                          <img
                            src={view.mediaUrls[m.assetId]}
                            alt={m.label || ""}
                            className="size-full object-cover"
                          />
                        )
                      ) : (
                        <div className="grid size-full place-items-center text-muted-foreground">
                          {m.kind === "video" ? (
                            <Video className="size-5" />
                          ) : (
                            <ImageIcon className="size-5" />
                          )}
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      aria-label="Remove"
                      onClick={() =>
                        set({ media: brief.media.filter((x) => x.assetId !== m.assetId) })
                      }
                      className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-sm backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100"
                    >
                      <X className="size-3.5" />
                    </button>
                    <select
                      aria-label="What it shows"
                      value={m.role}
                      onChange={(e) =>
                        set({
                          media: brief.media.map((x) =>
                            x.assetId === m.assetId
                              ? { ...x, role: e.target.value as MediaRole }
                              : x,
                          ),
                        })
                      }
                      className="absolute inset-x-1.5 bottom-1.5 h-7 rounded-full border-0 bg-background/85 px-2 text-[11px] font-medium text-foreground shadow-sm backdrop-blur outline-none"
                    >
                      {(Object.keys(ROLE_LABELS) as MediaRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </option>
                      ))}
                    </select>
                  </motion.div>
                ))}
              </AnimatePresence>
              {room > 0 && (
                <button
                  type="button"
                  data-testid="add-media"
                  disabled={busy === "upload"}
                  onClick={() => fileRef.current?.click()}
                  className="grid aspect-square place-items-center rounded-2xl bg-[var(--ds-well-bg)] text-muted-foreground transition-colors hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground"
                >
                  <span className="flex flex-col items-center gap-1 text-[11.5px] font-medium">
                    {busy === "upload" ? (
                      <Spinner className="size-5 animate-spin" />
                    ) : brief.media.length ? (
                      <Plus className="size-5" />
                    ) : (
                      <Upload className="size-5" />
                    )}
                    {busy === "upload" ? "Adding…" : "Add"}
                  </span>
                </button>
              )}
            </div>
            {!brief.media.length && (
              <p className="px-1 pt-2 text-[12px] text-muted-foreground">
                Drop photos or clips here.{" "}
                {playbook.needs.media
                  ? "This kind of campaign works best with your own."
                  : "Optional."}
              </p>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept="image/*,video/*"
            onChange={(e) => {
              void add(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      </div>
    </StepIntro>
  );
}

/* ───────────────────────── step 4: channels ───────────────────────── */

function Channels({ brief, set }: { brief: CampaignBrief; set(p: Partial<CampaignBrief>): void }) {
  const storyOk = brief.channels.some(isStoryPlatform);
  return (
    <StepIntro
      title="Where and how often"
      body="Mellox spreads the posts out and never puts two on the same channel on one day."
    >
      <div className="space-y-8">
        <div>
          <p className="mb-2 text-[12.5px] font-medium text-foreground/85">Channels</p>
          <PlatformLogoGrid
            platforms={CHANNELS}
            isSelected={(c) => brief.channels.includes(c)}
            onToggle={(c) =>
              set({
                channels: brief.channels.includes(c)
                  ? brief.channels.filter((x) => x !== c)
                  : [...brief.channels, c].slice(-5),
              })
            }
          />
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-medium text-foreground/85">How busy</p>
          <div className="grid gap-2 @md/campaigns:grid-cols-3">
            {CAMPAIGN_PACES.map((p) => {
              const on = brief.pace === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set({ pace: p })}
                  className={cn(
                    "ds-tile flex items-center justify-between gap-2 p-3.5 text-left transition-all",
                    on ? "ring-2 ring-primary/60" : "hover:ring-1 hover:ring-foreground/15",
                  )}
                >
                  <span className="text-[13px] font-medium">{PACE_LABELS[p]}</span>
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: p === "light" ? 1 : p === "steady" ? 2 : 3 }, (_, i) => (
                      <span
                        key={i}
                        className={cn(
                          "h-3 w-1 rounded-full",
                          on ? "bg-primary" : "bg-foreground/25",
                        )}
                      />
                    ))}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="ds-tile flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">Stories too</p>
            <p className="text-[12.5px] text-muted-foreground">
              {storyOk
                ? "Countdowns, behind the scenes and reminders on Instagram and Facebook."
                : "Add Instagram or Facebook to plan Stories."}
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={brief.stories && storyOk}
            aria-label="Stories"
            disabled={!storyOk}
            onClick={() => set({ stories: !brief.stories })}
            className={cn(
              "relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40",
              brief.stories && storyOk ? "bg-primary" : "bg-foreground/20",
            )}
          >
            <motion.span
              className="absolute top-0.5 size-5 rounded-full bg-background shadow"
              animate={{ left: brief.stories && storyOk ? 22 : 2 }}
              transition={{ type: "spring", stiffness: 420, damping: 32 }}
            />
          </button>
        </div>

        <div className="grid gap-5 @2xl/campaigns:grid-cols-2">
          <Field label="Hashtag" hint="Optional. Used on every post.">
            <input
              className={input}
              value={brief.hashtag}
              maxLength={40}
              placeholder="#"
              onChange={(e) => set({ hashtag: e.target.value })}
            />
          </Field>
          <Field label="Tone" hint="Optional. Your Brand DNA voice is used either way.">
            <input
              className={input}
              value={brief.tone}
              maxLength={80}
              placeholder="e.g. playful, warm"
              onChange={(e) => set({ tone: e.target.value })}
            />
          </Field>
        </div>
      </div>
    </StepIntro>
  );
}

/* ───────────────────────── step 5: preview ───────────────────────── */

function Preview({
  playbook,
  brief,
  view,
}: {
  playbook: Playbook;
  brief: CampaignBrief;
  view: CampaignsView;
}) {
  const plan = useMemo(() => {
    const taken: TakenSlot[] = [
      ...view.home.campaigns
        .filter((c) => c.status === "running" || c.status === "paused" || c.status === "ready")
        .filter((c) => c.id !== view.selected?.id)
        .flatMap((c) => takenBy(c.pieces)),
      ...view.home.everyday.map((e) => ({ date: e.date, platform: e.platform })),
    ];
    const skeleton = buildCampaignSkeleton(playbook, brief, taken, view.today);
    const pieces = assignMedia(
      playbook,
      settleFormats(playbook, skeleton.pieces, brief.media),
      brief.media,
    );
    return { ...skeleton, pieces };
  }, [playbook, brief, view.home, view.selected?.id, view.today]);

  const feed = plan.pieces.filter((p) => p.format !== "story");
  const stories = plan.pieces.length - feed.length;

  return (
    <StepIntro
      title="Your campaign"
      body={`${feed.length} posts${stories ? ` and ${stories} Stories` : ""} from ${shortDate(plan.startsOn)} to ${shortDate(plan.endsOn)}. Write the plan and Mellox fills in what each one says.`}
    >
      <ol className="relative space-y-6 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-border/70">
        {plan.phases.map((ph, i) => {
          const pp = plan.pieces.filter((p) => p.phase === ph.id);
          const step = phaseOf(playbook, ph.id);
          return (
            <motion.li
              key={ph.id}
              className="relative pl-9"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.slow, ease: ease.emphasized, delay: i * 0.06 }}
            >
              <span className="absolute left-0 top-0.5 grid size-6 place-items-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground shadow-[0_0_0_4px_hsl(var(--background))]">
                {i + 1}
              </span>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <p className="text-[14px] font-semibold">{ph.label}</p>
                <p className="text-[12px] text-muted-foreground">
                  {ph.startsOn === ph.endsOn
                    ? shortDate(ph.startsOn)
                    : `${shortDate(ph.startsOn)} – ${shortDate(ph.endsOn)}`}
                </p>
              </div>
              <p className="mt-0.5 max-w-2xl text-[12.5px] leading-relaxed text-muted-foreground">
                {step.purpose}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {pp.map((p) => (
                  <PreviewChip
                    key={p.id}
                    piece={p}
                    brief={brief}
                    cta={step.cta}
                    mediaUrls={view.mediaUrls}
                  />
                ))}
                {!pp.length && (
                  <span className="text-[12px] text-muted-foreground">
                    No free day for this step on your channels.
                  </span>
                )}
              </div>
            </motion.li>
          );
        })}
      </ol>
      {plan.skipped > 0 && (
        <p className="mt-6 text-[12px] text-muted-foreground">
          {plan.skipped} post{plan.skipped === 1 ? "" : "s"} left out because those days already
          have one.
        </p>
      )}
    </StepIntro>
  );
}

function PreviewChip({
  piece,
  brief,
  cta,
  mediaUrls,
}: {
  piece: CampaignPiece;
  brief: CampaignBrief;
  cta: "none" | "soft" | "link";
  mediaUrls: Record<string, string>;
}) {
  const link = piece.format === "story" ? null : linkRule(piece.platform, brief.goal, cta).mode;
  const photo = piece.mediaIds.map((id) => mediaUrls[id]).find(Boolean);
  return (
    <div className="ds-tile flex items-center gap-2.5 p-2 pr-3">
      <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-[var(--ds-well-bg)]">
        {photo ? (
          <img src={photo} alt="" className="size-full object-cover" />
        ) : (
          <ChannelMark platform={piece.platform} size={26} />
        )}
        {photo && (
          <ChannelMark
            platform={piece.platform}
            size={15}
            className="absolute bottom-0.5 right-0.5"
          />
        )}
      </span>
      <span className="min-w-0">
        <span className="block text-[11.5px] font-medium tabular-nums text-foreground/85">
          {shortDate(piece.date)} · {piece.time}
        </span>
        <span className="mt-0.5 flex items-center gap-1">
          <FormatChip format={piece.format} className="h-5 px-1.5 text-[10px]" />
          {link === "caption" && <span className="text-[10px] font-medium text-primary">link</span>}
          {link === "bio" && <span className="text-[10px] text-muted-foreground">link in bio</span>}
        </span>
      </span>
    </div>
  );
}

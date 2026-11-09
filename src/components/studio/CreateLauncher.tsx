"use client";

// The one entry point for making something (Holo's "Choose creation method").
// On desktop it is a page on the canvas, not a pop-up: a centred two-column
// grid of method cards. Pick a category, then a format when there is more
// than one; the grid slides to the next step in place and Back is one step
// out. Standard formats open the Studio composer (also on the canvas); the
// creator video ad opens its own studio.
import { PlanLock } from "@/components/app/billing/billing-ui";
import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import { ArrowRight, Sparkles } from "@/components/icons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { addAppEventListener, removeAppEventListener } from "@/lib/app-events";
import {
  STUDIO_FORMATS,
  STUDIO_GROUPS,
  type StudioGroup,
  type StudioType,
} from "@/lib/studio/formats";
import { UGC_ENTRY } from "@/lib/studio/ugc-entry";
import { useOpenCreate } from "./use-open-create";
import { UploadCreationFlow } from "./UploadCreationFlow";

const GROUP_ILLO: Record<StudioGroup, IlloKind> = {
  video: "video",
  stories: "story",
  picture: "post",
  text: "article",
  ads: "ad",
};

const TYPE_ILLO: Record<StudioType, IlloKind> = {
  video: "video",
  script: "animate",
  story: "story",
  image: "post",
  carousel: "carousel",
  social: "swipe",
  article: "article",
  ad: "ad",
};

/** One short line per category (the heading and the card). */
const GROUP_LINE: Record<StudioGroup, string> = {
  video: "Clips and reels",
  stories: "Full-screen frames",
  picture: "Posts and carousels",
  text: "Captions and blogs",
  ads: "Built to sell",
};

type Option =
  | { kind: "studio"; type: StudioType; label: string; tagline: string }
  | { kind: "ugc"; label: string; tagline: string; badge: string };

function optionsFor(group: StudioGroup): Option[] {
  const studio: Option[] = (STUDIO_GROUPS.find((g) => g.id === group)?.types ?? []).map((t) => ({
    kind: "studio",
    type: t,
    label: STUDIO_FORMATS[t].label,
    tagline: STUDIO_FORMATS[t].tagline,
  }));
  if (group !== UGC_ENTRY.group) return studio;
  return [
    { kind: "ugc", label: UGC_ENTRY.label, tagline: UGC_ENTRY.description, badge: UGC_ENTRY.badge },
    ...studio,
  ];
}

const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

/** A Holo method card: picture on the left, bold title, one grey line. */
function MethodCard({
  label,
  line,
  illo,
  badge,
  lock,
  index,
  onClick,
}: {
  label: string;
  line: string;
  illo: IlloKind;
  badge?: string;
  lock?: React.ReactNode;
  index: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={rise(index)}
      className="ds-card ds-card-hover ds-rise group relative flex min-h-[84px] min-w-0 items-center gap-3.5 p-2.5 pr-4 text-left active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[419px]:min-h-0 max-[419px]:flex-col max-[419px]:items-start max-[419px]:gap-1.5 max-[419px]:pr-2.5 [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:p-1.5"
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105 max-[419px]:size-12 max-[419px]:rounded-[14px] [@media(max-height:500px)]:size-10"
      >
        <Illustration
          kind={illo}
          className="size-16 max-[419px]:size-12 [@media(max-height:500px)]:size-10"
        />
      </span>
      <span
        aria-hidden
        className={`min-w-0 flex-1 max-[419px]:w-full${badge ? " pr-10 max-[419px]:pr-0" : ""}`}
      >
        <span className="flex items-center gap-1.5 text-[16px] font-bold tracking-[-0.015em] max-[419px]:text-[14px]">
          <span className="truncate">{label}</span>
          {lock}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-muted-foreground max-[419px]:text-[11px] [@media(max-height:500px)]:line-clamp-1">
          {line}
        </span>
      </span>
      {badge ? (
        // Holo's sticker: a tilted pill in the card's corner (inside it: the
        // hover card clips what overhangs).
        <span
          aria-hidden
          className="ds-grad-pill absolute right-2 top-2 rotate-[6deg] rounded-full px-2.5 py-0.5 text-[10.5px] font-bold shadow-[0_6px_14px_-6px_rgb(46_230_107/0.9)] transition-transform group-hover:rotate-0"
        >
          {badge}
        </span>
      ) : null}
      <ArrowRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100 group-focus-visible:opacity-100 max-[419px]:hidden"
      />
    </button>
  );
}

export function CreateLauncher() {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<StudioGroup | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const reduce = useReducedMotionSafe();

  useEffect(() => {
    const onOpen = () => {
      setGroupId(null);
      setOpen(true);
    };
    addAppEventListener("open:create-launcher", onOpen);
    return () => removeAppEventListener("open:create-launcher", onOpen);
  }, []);

  // Video (Studio clip and creator video ads) needs a plan with videos.
  const create = useOpenCreate();
  const choiceOf = (option: Option) => (option.kind === "ugc" ? "ugc" : option.type);
  const lockFor = (option: Option) => create.lockFor(choiceOf(option));

  const pick = (option: Option) => {
    // A locked pick closes too: the upgrade screen takes its place.
    if (create.open(choiceOf(option)) || lockFor(option)) setOpen(false);
  };

  const enter = (id: StudioGroup) => {
    const options = optionsFor(id);
    if (options.length === 1) {
      pick(options[0]);
      return;
    }
    setGroupId(id);
  };

  const group = STUDIO_GROUPS.find((g) => g.id === groupId) ?? null;
  // Forward slides in from the right, Back from the left.
  const dir = group ? 1 : -1;
  const shift = reduce ? 0 : 36;

  return (
    <>
      <AppModalShell
        navId="create"
        open={open}
        onOpenChange={setOpen}
        // Big, so on desktop it is a page on the canvas (Back pill, no
        // blurred backdrop); on phones it is a full screen.
        size="xl"
        allowMaximize={false}
        Icon={Sparkles}
        title={group ? group.label : "Create"}
        onBack={group ? () => setGroupId(null) : undefined}
        srDescription="Choose what to make, then pick a format if there are multiple options."
        bodyClassName="overflow-x-hidden px-4 pb-6 pt-1 sm:px-8 [@media(max-height:500px)]:p-2"
      >
        <div className="flex min-h-full flex-col items-center justify-center py-2 sm:py-8 [@media(max-height:500px)]:py-0">
          <div className="w-full max-w-[720px]">
            <AnimatePresence mode="wait" initial={false} custom={dir}>
              <motion.div
                key={group?.id ?? "all"}
                custom={dir}
                variants={{
                  in: (d: number) => ({ opacity: 0, x: d * shift }),
                  show: { opacity: 1, x: 0 },
                  out: (d: number) => ({ opacity: 0, x: d * -shift }),
                }}
                initial="in"
                animate="show"
                exit="out"
                transition={{ type: "spring", stiffness: 460, damping: 38, mass: 0.7 }}
              >
                <div className="mb-6 text-center max-[419px]:mb-4 [@media(max-height:500px)]:hidden">
                  <h3 className="text-[24px] font-bold leading-tight tracking-[-0.025em] max-[419px]:text-[21px] sm:text-[28px]">
                    {group ? (
                      <>
                        Choose a <span className="ds-grad-text">format</span>
                      </>
                    ) : (
                      <>
                        What do you want to <span className="ds-grad-text">make</span>?
                      </>
                    )}
                  </h3>
                  <p className="mt-1.5 text-[13px] text-muted-foreground max-[419px]:hidden">
                    {group ? GROUP_LINE[group.id] : "On brand, every time."}
                  </p>
                </div>

                {!group ? (
                  <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:grid-cols-3 [@media(max-height:500px)]:gap-1.5">
                    {STUDIO_GROUPS.map((g, i) => (
                      <MethodCard
                        key={g.id}
                        index={i}
                        label={g.label}
                        line={GROUP_LINE[g.id]}
                        illo={GROUP_ILLO[g.id]}
                        onClick={() => enter(g.id)}
                      />
                    ))}
                    <MethodCard
                      index={STUDIO_GROUPS.length}
                      label="Upload"
                      line="Design with your own photo or video"
                      illo="website"
                      onClick={() => {
                        setOpen(false);
                        setUploadOpen(true);
                      }}
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:gap-1.5">
                    {optionsFor(group.id).map((o, i) => {
                      const lock = lockFor(o);
                      return (
                        <MethodCard
                          key={o.kind === "ugc" ? "ugc" : o.type}
                          index={i}
                          label={o.label}
                          line={o.tagline}
                          illo={o.kind === "ugc" ? "video" : TYPE_ILLO[o.type]}
                          badge={
                            i === 0 && !lock ? (o.kind === "ugc" ? o.badge : "Best") : undefined
                          }
                          lock={lock ? <PlanLock plan={lock} /> : undefined}
                          onClick={() => pick(o)}
                        />
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </AppModalShell>
      <UploadCreationFlow open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}

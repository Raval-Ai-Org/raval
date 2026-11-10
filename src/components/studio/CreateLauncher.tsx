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
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { UGC_ENTRY } from "@/lib/studio/ugc-entry";
import { useOpenCreate } from "./use-open-create";
import { UploadCreationFlow } from "./UploadCreationFlow";
import { GradProgress, StepPills } from "@/components/app/surface/MoxParts";
import { MoxFace } from "@/components/brand/mox/MoxFace";

const CREATE_STEPS = [
  { id: "kind", label: "Kind" },
  { id: "format", label: "Format" },
  { id: "brief", label: "Brief" },
];

/**
 * What a person can make, sorted the way people think about it (not by our
 * internal formats). Each option opens an existing place: a Studio composer
 * (sometimes started on a video kind or mode), the creator video studio, or
 * Animate. Nothing is made or charged until Generate.
 */
type Option = {
  id: string;
  label: string;
  line: string;
  illo: IlloKind;
  badge?: string;
} & (
  | { kind: "studio"; type: StudioType; controls?: Pick<StudioControls, "videoKind" | "videoMode"> }
  | { kind: "ugc" }
  | { kind: "animate" }
  | { kind: "upload" }
);

type Category = {
  id: string;
  label: string;
  /** One short line on the card and under the heading. */
  line: string;
  illo: IlloKind;
  badge?: string;
  options: Option[];
};

const studio = (
  type: StudioType,
  extra: Partial<Omit<Option, "kind">> & {
    controls?: Pick<StudioControls, "videoKind" | "videoMode">;
  } = {},
): Option => ({
  id: extra.id ?? type,
  kind: "studio",
  type,
  label: extra.label ?? STUDIO_FORMATS[type].label,
  line: extra.line ?? STUDIO_FORMATS[type].tagline,
  illo: extra.illo ?? TYPE_ILLO[type],
  badge: extra.badge,
  controls: extra.controls,
});

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

/*
 * Six groups, in the order people reach for them: posts first, then video
 * made from an idea, then what a person brings (photos, clips), then ads and
 * writing. Every group is a different starting point, so no format appears
 * twice and no group is a single card.
 */
export const CREATE_CATEGORIES: Category[] = [
  {
    id: "posts",
    label: "Social posts",
    line: "Pictures, carousels and Stories",
    illo: "post",
    options: [
      studio("image", { label: "Image post", line: "One designed picture, captions included" }),
      studio("carousel", { label: "Carousel", line: "Swipeable slides that tell one story" }),
      studio("story", { label: "Story", line: "Full-screen frames for Instagram and Facebook" }),
      studio("social", { label: "Text post", line: "Just the words, written for each platform" }),
    ],
  },
  {
    id: "video",
    label: "AI video",
    line: "Describe it, Mox makes the video",
    illo: "video",
    options: [
      studio("video", { label: "Video from an idea", line: "A short clip made from your brief" }),
      studio("video", {
        id: "product-demo",
        label: "Product demo",
        line: "Your product, shown in use",
        controls: { videoKind: "product-demo" },
      }),
      studio("video", {
        id: "motion-graphics",
        label: "Motion graphics",
        line: "Animated words and shapes in your look",
        illo: "poster",
        controls: { videoMode: "motion" },
      }),
      studio("video", {
        id: "motion-post",
        label: "Looping post",
        line: "Your post with smooth motion, made to loop",
        illo: "swipe",
        controls: { videoKind: "motion-post" },
      }),
      studio("video", {
        id: "site",
        label: "Website tour",
        line: "Your site scrolling in a phone or laptop",
        illo: "website",
        controls: { videoMode: "site" },
      }),
    ],
  },
  {
    id: "photos",
    label: "From your photos",
    line: "Bring pictures, Mox does the rest",
    illo: "animate",
    badge: "New",
    options: [
      {
        id: "animate",
        kind: "animate",
        label: "Animate a photo",
        line: "Pick a photo and a motion, it comes to life",
        illo: "animate",
        badge: "New",
      },
      studio("video", {
        id: "recap",
        label: "Photo slideshow",
        line: "Your photos edited into one short video",
        illo: "story",
        controls: { videoMode: "recap" },
      }),
      {
        id: "upload",
        kind: "upload",
        label: "Design with my photo",
        line: "Upload a photo, Mox designs the post around it",
        illo: "website",
      },
    ],
  },
  {
    id: "clips",
    label: "From your clips",
    line: "Upload footage, get a finished video",
    illo: "versions",
    badge: "New",
    options: [
      studio("video", {
        id: "clips",
        label: "Edit my clips",
        line: "The best parts cut together, with captions",
        illo: "video",
        controls: { videoMode: "brand" },
      }),
      studio("video", {
        id: "clips-titles",
        label: "Add titles to my clips",
        line: "Moving headline, logo and button on your footage",
        illo: "versions",
        badge: "New",
        controls: { videoMode: "brand" },
      }),
    ],
  },
  {
    id: "ads",
    label: "Ads",
    line: "Made to sell, ready to test",
    illo: "ad",
    options: [
      studio("ad", { label: "Image ad", line: "Ad copy and a finished visual" }),
      {
        id: "ugc",
        kind: "ugc",
        label: "Creator video ad",
        line: UGC_ENTRY.description,
        illo: "video",
        badge: UGC_ENTRY.badge,
      },
    ],
  },
  {
    id: "writing",
    label: "Writing",
    line: "Blog articles and video scripts",
    illo: "article",
    options: [
      studio("article", { label: "Blog article", line: "A full article, ready to publish" }),
      studio("script", { label: "Video script", line: "Shots and words to film yourself" }),
    ],
  },
];

const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

/** A Holo method card: picture on the left, bold title, one grey line. */
function MethodCard({
  label,
  line,
  illo,
  badge,
  lock,
  index,
  wide,
  onClick,
}: {
  label: string;
  line: string;
  illo: IlloKind;
  badge?: string;
  lock?: React.ReactNode;
  index: number;
  /** The last of an odd number spans both columns, so no card sits alone. */
  wide?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={rise(index)}
      className={`${wide ? "col-span-2 " : ""}ds-card ds-card-hover ds-rise group relative flex min-h-[84px] min-w-0 items-center gap-3.5 p-2.5 pr-4 text-left active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[419px]:min-h-0 max-[419px]:flex-col max-[419px]:items-start max-[419px]:gap-1.5 max-[419px]:pr-2.5 [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:p-1.5`}
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
  const [groupId, setGroupId] = useState<string | null>(null);
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
  const lockFor = (option: Option) =>
    option.kind === "animate" || option.kind === "upload"
      ? null
      : create.lockFor(option.kind === "ugc" ? "ugc" : option.type);

  const pick = (option: Option) => {
    if (option.kind === "animate") {
      setOpen(false);
      emitAppEvent("open:animate");
      return;
    }
    if (option.kind === "upload") {
      setOpen(false);
      setUploadOpen(true);
      return;
    }
    const opened =
      option.kind === "ugc"
        ? create.open("ugc")
        : create.open(option.type, option.controls ? { controls: option.controls } : undefined);
    // A locked pick closes too: the upgrade screen takes its place.
    if (opened || lockFor(option)) setOpen(false);
  };

  const enter = (id: string) => {
    const options = CREATE_CATEGORIES.find((c) => c.id === id)?.options ?? [];
    if (options.length === 1) {
      pick(options[0]);
      return;
    }
    setGroupId(id);
  };

  const group = CREATE_CATEGORIES.find((g) => g.id === groupId) ?? null;
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
            {/* Autopilot's steps: kind, format, then the brief in Studio. */}
            <div className="mb-6 flex flex-col items-center gap-2.5 max-[419px]:hidden [@media(max-height:500px)]:hidden">
              <StepPills
                steps={CREATE_STEPS}
                current={group ? "format" : "kind"}
                onPick={() => setGroupId(null)}
                className="max-w-full overflow-x-auto"
              />
              <GradProgress
                value={group ? 2 / 3 : 1 / 3}
                className="w-full max-w-[240px]"
                label="Create progress"
              />
            </div>
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
                <div className="mb-6 flex flex-col items-center text-center max-[419px]:mb-4 [@media(max-height:500px)]:hidden">
                  <span className="mox-float mb-2 max-[419px]:hidden">
                    <MoxFace mood={group ? "excited" : "happy"} size={48} track />
                  </span>
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
                    {group ? group.line : "Pick a kind. Mox keeps it on brand."}
                  </p>
                </div>

                {!group ? (
                  <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:grid-cols-3 [@media(max-height:500px)]:gap-1.5">
                    {CREATE_CATEGORIES.map((g, i) => (
                      <MethodCard
                        key={g.id}
                        index={i}
                        label={g.label}
                        line={g.line}
                        illo={g.illo}
                        badge={g.badge}
                        onClick={() => enter(g.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:gap-1.5">
                    {group.options.map((o, i) => {
                      const lock = lockFor(o);
                      return (
                        <MethodCard
                          key={o.id}
                          index={i}
                          wide={group.options.length % 2 === 1 && i === group.options.length - 1}
                          label={o.label}
                          line={o.line}
                          illo={o.illo}
                          badge={lock ? undefined : (o.badge ?? (i === 0 ? "Popular" : undefined))}
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

"use client";

// The one entry point for making something (Holo's "Choose creation method").
// On desktop it is a page on the canvas, not a pop-up: a centred two-column
// grid of method cards. Pick a starting point, then a format when there is
// more than one; the grid slides to the next step in place and Back is one
// step out. A search box finds any format by its everyday name ("ugc",
// "slideshow", "reel"). Every format card says what the person brings, and
// the screen it opens asks for exactly that (`src/lib/studio/start.ts`).
import { PlanLock } from "@/components/app/billing/billing-ui";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import { ArrowRight, Search, Sparkles, X } from "@/components/icons";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import {
  addAppEventListener,
  emitAppEvent,
  removeAppEventListener,
  type AppEvent,
} from "@/lib/app-events";
import { rememberCreateSpot, takeCreateSpot } from "@/lib/studio/create-return";
import { getStudioState } from "@/lib/studio/session-store";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import type { StudioControls } from "@/lib/studio/jobs";
import { needsLine, startIdFor } from "@/lib/studio/start";
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

export type StartControls = Pick<StudioControls, "videoKind" | "videoMode" | "recapMotion">;

/**
 * What a person can make, sorted the way people think about it (not by our
 * internal formats). Each option opens an existing place: a Studio composer
 * (started on the video kind or mode it names), the creator video studio, or
 * Animate. Nothing is made or charged until Generate.
 */
type Option = {
  id: string;
  label: string;
  line: string;
  illo: IlloKind;
  badge?: string;
  /** What the person brings ("You add: 2 to 6 photos"). */
  needs: string;
  /** Extra words the search box matches ("ugc", "reel", "slideshow"). */
  keywords?: string;
} & (
  | { kind: "studio"; type: StudioType; controls?: Partial<StartControls> }
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
  /** A creator's face instead of the illustration. */
  photo?: string;
  badge?: string;
  /** Spans both columns on the first screen. */
  wide?: boolean;
  options: Option[];
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

const studio = (
  type: StudioType,
  extra: Partial<Pick<Option, "id" | "label" | "line" | "illo" | "badge" | "keywords">> & {
    controls?: Partial<StartControls>;
  } = {},
): Option => {
  const start = startIdFor(type, extra.controls ?? {});
  return {
    id: extra.id ?? type,
    kind: "studio",
    type,
    label: extra.label ?? STUDIO_FORMATS[type].label,
    line: extra.line ?? STUDIO_FORMATS[type].tagline,
    illo: extra.illo ?? TYPE_ILLO[type],
    badge: extra.badge,
    keywords: extra.keywords,
    needs: start ? needsLine(start) : "Just describe it",
    controls: extra.controls,
  };
};

const UGC_OPTION: Option = {
  id: "ugc",
  kind: "ugc",
  label: "AI creator video",
  line: "A creator talks about your product, like a real UGC Reel",
  illo: "video",
  badge: UGC_ENTRY.badge,
  needs: "You pick: creator, product",
  keywords: "ugc creator influencer testimonial review talking person actor reel tiktok ad",
};

/*
 * Six cards, kept simple. The tools Mellox is for come first: the AI creator
 * (UGC) video and the product video open straight away, a post becomes a
 * video ad, then social posts and ads. Everything else waits in "More ways
 * to make". The creator video also sits under Ads, because people look for
 * it there too.
 */
export const CREATE_CATEGORIES: Category[] = [
  {
    id: "creator",
    label: "AI creator video",
    line: "A creator talks up your product (UGC)",
    illo: "video",
    photo: "/creators/amara.jpg",
    badge: "Most used",
    wide: true,
    options: [UGC_OPTION],
  },
  {
    id: "product",
    label: "Product video",
    line: "Your product, animated",
    illo: "poster",
    options: [
      studio("video", {
        id: "product-motion",
        label: "Product video",
        line: "Your product turning, pouring, opening, no people",
        illo: "poster",
        keywords: "product animation animate packshot spin showcase demo",
        controls: { videoKind: "product-motion" },
      }),
    ],
  },
  {
    id: "post-video",
    label: "Post to video ad",
    line: "A post or photo, set in motion",
    illo: "animate",
    badge: "New",
    options: [
      {
        id: "animate",
        kind: "animate",
        label: "Post to video ad",
        line: "Pick a post or photo, then how it moves",
        illo: "animate",
        needs: "You add: a post or photo",
        keywords: "animate photo image to video bring to life move motion reel loop",
      },
    ],
  },
  {
    id: "posts",
    label: "Social posts",
    line: "Image, carousel, Story, text",
    illo: "post",
    options: [
      studio("image", {
        label: "Image post",
        line: "One designed picture, captions included",
        keywords: "photo picture instagram feed single",
      }),
      studio("carousel", {
        label: "Carousel",
        line: "Swipeable slides that tell one story",
        keywords: "slides swipe linkedin document",
      }),
      studio("story", {
        label: "Story",
        line: "Full-screen frames for Instagram and Facebook",
        keywords: "stories vertical frames",
      }),
      studio("social", {
        label: "Text post",
        line: "Just the words, written for each platform",
        keywords: "caption words tweet thread linkedin",
      }),
    ],
  },
  {
    id: "ads",
    label: "Ads",
    line: "Creator, product and image ads",
    illo: "ad",
    options: [
      {
        ...UGC_OPTION,
        id: "ugc",
        label: "Creator video ad",
        line: "A creator sells it in their own words",
      },
      studio("video", {
        id: "ad-product-video",
        label: "Product video ad",
        line: "Your product in motion, ending on your offer",
        illo: "poster",
        keywords: "product video ad commercial offer",
        controls: { videoKind: "offer-teaser" },
      }),
      studio("ad", {
        label: "Image ad",
        line: "Pick the goal: sell, leads, clicks or win back",
        keywords: "meta facebook google banner sales leads traffic retarget",
      }),
    ],
  },
  {
    id: "more",
    label: "More to make",
    line: "Clips, photos, website, writing",
    illo: "versions",
    wide: true,
    options: [
      studio("video", {
        id: "clips",
        label: "Edit my clips",
        line: "The best parts cut together, with captions",
        illo: "video",
        keywords: "footage edit cut captions subtitles titles logo reel",
        controls: { videoMode: "brand" },
      }),
      studio("video", {
        id: "recap",
        label: "Photo slideshow",
        line: "Your photos edited into one short video",
        illo: "story",
        keywords: "recap slideshow montage photos to video",
        controls: { videoMode: "recap", recapMotion: "camera" },
      }),
      {
        id: "upload",
        kind: "upload",
        label: "Design with my photo",
        line: "Upload a photo, Mox designs the post around it",
        illo: "website",
        needs: "You add: 1 photo",
        keywords: "upload my picture own photo post design",
      },
      studio("video", {
        id: "site",
        label: "Website tour",
        line: "Your site scrolling in a phone or laptop",
        illo: "website",
        keywords: "website scroll screen recording demo",
        controls: { videoMode: "site" },
      }),
      studio("video", {
        label: "AI video from an idea",
        line: "A short clip made from your words",
        keywords: "reel tiktok short clip generate text to video",
      }),
      studio("video", {
        id: "motion-graphics",
        label: "Motion graphics",
        line: "Animated words and shapes in your look",
        illo: "poster",
        keywords: "animation kinetic text typography sale",
        controls: { videoKind: "motion-graphics", videoMode: "motion" },
      }),
      studio("article", {
        label: "Blog article",
        line: "A full article, ready to publish",
        keywords: "blog seo post article writing",
      }),
      studio("script", {
        label: "Video script",
        line: "Shots and words to film yourself",
        keywords: "script screenplay film writing",
      }),
    ],
  },
];

/** Every option once, for the search box. */
const ALL_OPTIONS: Option[] = (() => {
  const seen = new Set<string>();
  return CREATE_CATEGORIES.flatMap((c) => c.options).filter((o) => {
    if (seen.has(o.id)) return false;
    seen.add(o.id);
    return true;
  });
})();

/** Options whose words contain every typed word. */
export function searchCreateOptions(query: string): Option[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return ALL_OPTIONS.filter((o) => {
    const hay = `${o.label} ${o.line} ${o.keywords ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

const rise = (i: number) => ({ ["--i" as string]: i }) as CSSProperties;

/** A Holo method card: picture on the left, bold title, one grey line. */
function MethodCard({
  label,
  line,
  needs,
  illo,
  photo,
  badge,
  lock,
  index,
  wide,
  onClick,
}: {
  label: string;
  line: string;
  /** What the person brings, as a small tag under the line. */
  needs?: string;
  illo: IlloKind;
  photo?: string;
  badge?: string;
  lock?: React.ReactNode;
  index: number;
  /** The last of an odd number spans both columns, so no card sits alone. */
  wide?: boolean | "roomy";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={rise(index)}
      className={`${wide === "roomy" ? "min-[420px]:[@media(min-height:501px)]:col-span-2 " : wide ? "col-span-2 " : ""}ds-card ds-card-hover ds-rise group relative flex min-h-[84px] min-w-0 items-center gap-3.5 p-2.5 pr-4 text-left active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary max-[419px]:min-h-0 max-[419px]:flex-col max-[419px]:items-start max-[419px]:gap-1.5 max-[419px]:pr-2.5 [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:p-1.5`}
    >
      <span className="sr-only">
        {label}. {line}
        {needs ? `. ${needs}` : ""}
      </span>
      <span
        aria-hidden
        className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-[18px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105 max-[419px]:size-12 max-[419px]:rounded-[14px] [@media(max-height:500px)]:size-10"
      >
        {photo ? (
          <img src={photo} alt="" className="size-full object-cover object-top" />
        ) : (
          <Illustration
            kind={illo}
            className="size-16 max-[419px]:size-12 [@media(max-height:500px)]:size-10"
          />
        )}
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
        {needs ? (
          <span className="mt-1.5 inline-flex max-w-full rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10.5px] font-semibold text-foreground/75 [@media(max-height:500px)]:hidden">
            <span className="truncate">{needs}</span>
          </span>
        ) : null}
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
  const [query, setQuery] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const reduce = useReducedMotionSafe();

  useEffect(() => {
    const onOpen = (event: AppEvent<"open:create-launcher">) => {
      // Back from a place opened here returns to the list it was picked from.
      const back = event.detail?.back;
      const spot = back ? takeCreateSpot(back) : undefined;
      setGroupId(spot ?? null);
      setQuery("");
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

  // The list a pick came from (null: the first screen), for Back.
  const from = query.trim() ? null : groupId;
  const pick = (option: Option) => {
    if (option.kind === "animate") {
      rememberCreateSpot("animate", from);
      setOpen(false);
      emitAppEvent("open:animate", { fromCreate: true });
      return;
    }
    if (option.kind === "upload") {
      setOpen(false);
      setUploadOpen(true);
      return;
    }
    if (option.kind === "ugc") rememberCreateSpot("ugc", from);
    const opened =
      option.kind === "ugc"
        ? create.open("ugc", { fromCreate: true })
        : create.open(option.type, option.controls ? { controls: option.controls } : undefined);
    if (opened && option.kind === "studio") rememberCreateSpot(getStudioState().activeId, from);
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

  const searching = query.trim().length > 0;
  const found = searching ? searchCreateOptions(query) : [];
  const group = searching ? null : (CREATE_CATEGORIES.find((g) => g.id === groupId) ?? null);
  // Forward slides in from the right, Back from the left.
  const dir = group ? 1 : -1;
  const shift = reduce ? 0 : 36;

  const optionGrid = (options: Option[]) => (
    <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:gap-1.5">
      {options.map((o, i) => {
        const lock = lockFor(o);
        return (
          <MethodCard
            key={o.id}
            index={i}
            wide={options.length % 2 === 1 && i === options.length - 1}
            label={o.label}
            line={o.line}
            needs={o.needs}
            illo={o.illo}
            badge={lock ? undefined : o.badge}
            lock={lock ? <PlanLock plan={lock} /> : undefined}
            onClick={() => pick(o)}
          />
        );
      })}
    </div>
  );

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
        onBack={group ? () => setGroupId(null) : searching ? () => setQuery("") : undefined}
        srDescription="Choose what to make, then pick a format if there are multiple options."
        bodyClassName="overflow-x-hidden px-4 pb-6 pt-1 sm:px-8 [@media(max-height:500px)]:p-2"
      >
        <div className="flex min-h-full flex-col items-center justify-center py-2 sm:py-8 [@media(max-height:500px)]:py-0">
          <div className="w-full max-w-[720px]">
            {/* Autopilot's steps: kind, format, then the brief in Studio. */}
            <div className="mb-6 flex flex-col items-center gap-2.5 max-[419px]:hidden [@media(max-height:500px)]:hidden">
              <StepPills
                steps={CREATE_STEPS}
                current={group || searching ? "format" : "kind"}
                onPick={() => {
                  setGroupId(null);
                  setQuery("");
                }}
                className="max-w-full overflow-x-auto"
              />
              <GradProgress
                value={group || searching ? 2 / 3 : 1 / 3}
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
                    {group
                      ? `${group.line}. Each one says what you add.`
                      : "Pick a starting point, or search for a format."}
                  </p>
                </div>

                {!group ? (
                  <label className="mb-4 flex h-11 items-center max-[419px]:hidden [@media(max-height:500px)]:hidden gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-4 shadow-[var(--ds-card-shadow)] focus-within:border-primary-border [@media(max-height:500px)]:mb-2 [@media(max-height:500px)]:h-9">
                    <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="sr-only">Search formats</span>
                    <input
                      ref={searchRef}
                      type="search"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search: UGC, carousel, slideshow, blog…"
                      className="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:hidden"
                    />
                    {searching ? (
                      <button
                        type="button"
                        aria-label="Clear search"
                        onClick={() => {
                          setQuery("");
                          searchRef.current?.focus();
                        }}
                        className="grid size-7 place-items-center rounded-full text-muted-foreground hover:bg-[var(--ds-well-bg)] hover:text-foreground"
                      >
                        <X className="size-3.5" />
                      </button>
                    ) : null}
                  </label>
                ) : null}

                {searching ? (
                  found.length ? (
                    optionGrid(found)
                  ) : (
                    <p className="py-10 text-center text-[13px] text-muted-foreground">
                      Nothing called that yet. Try “video”, “post” or “ad”.
                    </p>
                  )
                ) : !group ? (
                  <div className="grid grid-cols-2 gap-2.5 min-[420px]:gap-3 [@media(max-height:500px)]:grid-cols-3 [@media(max-height:500px)]:gap-1.5">
                    {CREATE_CATEGORIES.map((g, i) => {
                      const only = g.options.length === 1 ? g.options[0] : null;
                      const lock = only ? lockFor(only) : null;
                      return (
                        <MethodCard
                          key={g.id}
                          index={i}
                          label={g.label}
                          line={g.line}
                          illo={g.illo}
                          photo={g.photo}
                          wide={g.wide ? "roomy" : undefined}
                          badge={lock ? undefined : g.badge}
                          lock={lock ? <PlanLock plan={lock} /> : undefined}
                          onClick={() => enter(g.id)}
                        />
                      );
                    })}
                  </div>
                ) : (
                  optionGrid(group.options)
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

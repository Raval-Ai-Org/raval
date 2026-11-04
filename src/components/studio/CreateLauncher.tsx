"use client";

// The one entry point for making something (Holo's "Choose creation method"):
// a banner, then a two-column grid of choices, each with a picture. Pick a
// category, then a format when there is more than one. Standard formats open
// the Studio composer on the description step; the creator video ad opens
// its own studio.
import { PlanLock } from "@/components/app/billing/billing-ui";
import { useEffect, useState, type CSSProperties } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Illustration, type IlloKind } from "@/components/app/home/illustrations";
import { ArrowLeft, ArrowRight, Sparkles } from "@/components/icons";
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

/** One short line per category (the banner and the card). */
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

/** A Holo method card: picture tile, bold title, one grey line. */
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
      className="ds-card ds-card-hover ds-rise group relative flex min-h-[76px] min-w-0 items-center gap-3 p-2.5 text-left active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:p-1.5"
    >
      <span className="sr-only">{label}</span>
      <span
        aria-hidden
        className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-[16px] bg-[var(--ds-well-bg)] transition-transform duration-300 group-hover:-rotate-3 group-hover:scale-105 max-[359px]:size-11 [@media(max-height:500px)]:size-10"
      >
        <Illustration kind={illo} className="size-14 max-[359px]:size-11" />
      </span>
      <span aria-hidden className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[14.5px] font-bold tracking-[-0.01em] max-[359px]:text-[13px]">
          <span className="truncate">{label}</span>
          {lock}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground max-[359px]:text-[11px]">
          {line}
        </span>
      </span>
      {badge ? (
        <span
          aria-hidden
          className="ds-grad-pill shrink-0 self-start rounded-full px-2 py-0.5 text-[10px] font-bold shadow-[0_6px_14px_-6px_rgb(46_230_107/0.9)]"
        >
          {badge}
        </span>
      ) : (
        <ArrowRight
          aria-hidden
          className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 max-[359px]:hidden"
        />
      )}
    </button>
  );
}

export function CreateLauncher() {
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState<StudioGroup | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

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

  return (
    <>
      <AppModalShell
        navId="create"
        open={open}
        onOpenChange={setOpen}
        size="sm"
        Icon={Sparkles}
        title="Create"
        srDescription="Choose what to make, then pick a format if there are multiple options."
        headerAccessory={
          group ? (
            <button
              type="button"
              onClick={() => setGroupId(null)}
              aria-label="Back to all categories"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-3.5 text-[13px] font-semibold shadow-[var(--ds-card-shadow)] transition hover:-translate-x-0.5 lg:min-h-9"
            >
              <ArrowLeft className="size-4" />
              Back
            </button>
          ) : null
        }
        bodyClassName="overflow-x-hidden px-3 pb-4 pt-1 sm:px-5 sm:pb-5 [@media(max-height:500px)]:p-2"
      >
        {/* Banner (Holo): the Mox wash, one bold line and a picture. Hidden
            on short screens so the choices always fit. */}
        <div
          key={group?.id ?? "all"}
          className="ds-enter relative mb-4 h-[112px] overflow-hidden rounded-[20px] [background:var(--mox-gradient)] px-5 py-4 [@media(max-height:700px)]:hidden"
        >
          <span
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(70%_120%_at_100%_100%,rgb(255_255_255/0.55),transparent_60%)]"
          />
          <p className="relative text-[20px] font-bold leading-tight tracking-[-0.02em] text-[var(--mox-ink)]">
            {group ? group.label : "Make something new"}
          </p>
          <p className="relative mt-1 text-[12.5px] font-medium text-[var(--mox-ink)]/70">
            {group ? GROUP_LINE[group.id] : "On brand, every time."}
          </p>
          <Illustration
            kind={group ? GROUP_ILLO[group.id] : "rocket"}
            className="mox-float absolute -bottom-3 right-3 h-[120px] w-[150px]"
          />
        </div>

        <p className="mb-2.5 px-0.5 text-[15px] font-bold tracking-[-0.01em] [@media(max-height:500px)]:hidden">
          {group ? "Choose a format" : "What do you want to make?"}
        </p>

        {!group ? (
          <div className="grid grid-cols-1 gap-2.5 min-[320px]:grid-cols-2 [@media(max-height:500px)]:grid-cols-3 [@media(max-height:500px)]:gap-1.5">
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
              line="Your own photo or video"
              illo="website"
              onClick={() => {
                setOpen(false);
                setUploadOpen(true);
              }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 min-[420px]:grid-cols-2">
            {optionsFor(group.id).map((o, i) => {
              const lock = lockFor(o);
              return (
                <MethodCard
                  key={o.kind === "ugc" ? "ugc" : o.type}
                  index={i}
                  label={o.label}
                  line={o.tagline}
                  illo={o.kind === "ugc" ? "video" : TYPE_ILLO[o.type]}
                  badge={i === 0 && !lock ? (o.kind === "ugc" ? o.badge : "Best") : undefined}
                  lock={lock ? <PlanLock plan={lock} /> : undefined}
                  onClick={() => pick(o)}
                />
              );
            })}
          </div>
        )}
      </AppModalShell>
      <UploadCreationFlow open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}

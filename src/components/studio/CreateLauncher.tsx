"use client";

// The one entry point for making something: pick a category, then a format when
// there is more than one choice. Standard formats open the Studio composer on
// the description step; the creator video ad opens its own studio.
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { PlanLock } from "@/components/app/billing/billing-ui";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { useEffect, useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import {
  ArrowLeft,
  ArrowRight,
  Image as ImageIcon,
  Megaphone,
  MessageSquare,
  Sparkles,
  UserCircle2,
  Story,
  Video,
  Upload,
  type LucideIcon,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";
import { rememberStudioType } from "@/hooks/use-studio";
import { chooseType, openComposer } from "@/lib/studio/session-store";
import {
  STUDIO_FORMATS,
  STUDIO_GROUPS,
  type StudioGroup,
  type StudioType,
} from "@/lib/studio/formats";
import { UGC_ENTRY } from "@/lib/studio/ugc-entry";
import { TypeGlyph } from "./studio-ui";
import { UploadCreationFlow } from "./UploadCreationFlow";

const GROUP_ICON: Record<StudioGroup, LucideIcon> = {
  video: Video,
  stories: Story,
  picture: ImageIcon,
  text: MessageSquare,
  ads: Megaphone,
};

/** A real StudioType per group, only to borrow its `--tone` colour. */
const GROUP_TONE_TYPE: Record<StudioGroup, StudioType> = {
  video: "video",
  stories: "story",
  picture: "image",
  text: "social",
  ads: "ad",
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

const CARD =
  "group relative isolate cursor-pointer overflow-hidden rounded-2xl border border-border/80 bg-surface-3 text-left shadow-1 transition-[border-color,box-shadow,translate] duration-200 hover:-translate-y-0.5 hover:border-[hsl(var(--tone)/0.45)] hover:shadow-[0_18px_40px_-20px_hsl(var(--tone)/0.55)] active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--tone))]";

const GROUP_CARD_LAYOUT =
  "flex min-w-0 flex-row items-center gap-2.5 p-2.5 min-[320px]:min-h-[112px] min-[320px]:flex-col min-[320px]:items-stretch min-[320px]:gap-0 min-[320px]:p-3 max-[359px]:p-2 [@media(max-height:500px)]:min-h-0 [@media(max-height:500px)]:p-2";

/** A soft wash of the card's colour that fades in on hover. */
const GLOW = (
  <span
    aria-hidden
    className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(120%_80%_at_0%_0%,hsl(var(--tone)/0.14),transparent_60%)] opacity-0 transition-opacity duration-[--motion-duration-slow] group-hover:opacity-100"
  />
);

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

  const back = () => {
    setGroupId(null);
  };

  // Video (Studio clip and creator video ads) needs a plan with videos.
  const billing = useEntitlements();
  const videoLock =
    billing.data && !billing.data.features.ugc.allowed
      ? billing.data.features.ugc.requiredPlan
      : null;
  const lockFor = (option: Option) =>
    option.kind === "ugc" || option.type === "video" ? videoLock : null;

  const pick = (option: Option) => {
    if (lockFor(option)) {
      setOpen(false);
      openFeatureUpgrade("ugc");
      return;
    }
    if (option.kind === "ugc") {
      setOpen(false);
      emitAppEvent("open:ugc-studio");
      return;
    }
    rememberStudioType(option.type);
    const id = openComposer({ type: option.type });
    if (!id) return; // openComposer already explained why (e.g. no workspace)
    chooseType(id, option.type);
    setOpen(false);
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
        open={open}
        onOpenChange={setOpen}
        size="sm"
        Icon={group ? GROUP_ICON[group.id] : Sparkles}
        title={group ? group.label : "Create"}
        description={group ? "Choose a format" : "What would you like to make?"}
        srDescription="Choose what to make, then pick a format if there are multiple options."
        headerAccessory={
          group ? (
            <button
              type="button"
              onClick={back}
              aria-label="Back to all categories"
              className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:min-h-8"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
          ) : null
        }
        bodyClassName="overflow-x-hidden p-2 sm:p-4 [@media(max-height:500px)]:p-2"
      >
        {!group ? (
          <div className="grid grid-cols-1 gap-2 min-[320px]:grid-cols-2 [@media(max-height:500px)]:grid-cols-3">
            {STUDIO_GROUPS.map((g) => {
              const Icon = GROUP_ICON[g.id];
              const options = optionsFor(g.id);
              const summary =
                options.length === 1 ? options[0].tagline : options.map((o) => o.label).join(" · ");
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => enter(g.id)}
                  className={cn(`studio-tone-${GROUP_TONE_TYPE[g.id]}`, CARD, GROUP_CARD_LAYOUT)}
                >
                  {GLOW}
                  <span className="flex items-start justify-between">
                    <span className="studio-glyph grid size-10 place-items-center rounded-xl transition-transform duration-[--motion-duration-slow] ease-[--motion-ease-spring] group-hover:-rotate-6 group-hover:scale-110 max-[359px]:size-8 [@media(max-height:500px)]:size-8">
                      <Icon className="size-[22px]" />
                    </span>
                    <ArrowRight className="hidden size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 min-[320px]:block" />
                  </span>
                  <span className="min-w-0 min-[320px]:mt-2 max-[359px]:mt-1 [@media(max-height:500px)]:mt-1">
                    <span className="block text-[15px] font-semibold tracking-tight text-foreground max-[359px]:text-sm [@media(max-height:500px)]:text-sm">
                      {g.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground max-[359px]:text-[11px] max-[359px]:leading-tight [@media(max-height:500px)]:text-[11px] [@media(max-height:500px)]:leading-tight">
                      {summary}
                    </span>
                  </span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setUploadOpen(true);
              }}
              className={cn("studio-tone-upload", CARD, GROUP_CARD_LAYOUT)}
            >
              {GLOW}
              <span className="flex items-start justify-between">
                <span className="studio-glyph grid size-10 place-items-center rounded-xl transition-transform duration-[--motion-duration-slow] ease-[--motion-ease-spring] group-hover:-rotate-6 group-hover:scale-110 max-[359px]:size-8 [@media(max-height:500px)]:size-8">
                  <Upload className="size-[22px]" />
                </span>
                <ArrowRight className="hidden size-4 text-muted-foreground transition-transform duration-200 group-hover:translate-x-0.5 min-[320px]:block" />
              </span>
              <span className="min-w-0 min-[320px]:mt-2 max-[359px]:mt-1 [@media(max-height:500px)]:mt-1">
                <span className="block text-[15px] font-semibold tracking-tight text-foreground max-[359px]:text-sm [@media(max-height:500px)]:text-sm">
                  Upload
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground max-[359px]:text-[11px] max-[359px]:leading-tight [@media(max-height:500px)]:text-[11px] [@media(max-height:500px)]:leading-tight">
                  Add your own photo, video or post
                </span>
              </span>
            </button>
          </div>
        ) : (
          <ul className="grid gap-2.5">
            {optionsFor(group.id).map((o) => (
              <li key={o.kind === "ugc" ? "ugc" : o.type}>
                <button
                  type="button"
                  onClick={() => pick(o)}
                  className={cn(
                    o.kind === "ugc" ? "studio-tone-ugc" : `studio-tone-${o.type}`,
                    CARD,
                    "flex w-full items-center gap-3.5 p-3.5",
                  )}
                >
                  {GLOW}
                  {o.kind === "ugc" ? (
                    <span className="studio-glyph grid size-11 shrink-0 place-items-center rounded-xl">
                      <UserCircle2 className="size-5" />
                    </span>
                  ) : (
                    <TypeGlyph type={o.type} className="size-11 rounded-xl [&_svg]:size-5" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-foreground">
                      {o.label}
                      {o.kind === "ugc" ? (
                        <span className="rounded-full bg-[hsl(var(--tone)/0.14)] px-1.5 py-px text-[10px] font-semibold text-[var(--tone-ink)] ring-1 ring-[hsl(var(--tone)/0.3)]">
                          {o.badge}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                      {o.tagline}
                    </span>
                  </span>
                  {lockFor(o) ? (
                    <PlanLock plan={lockFor(o)!} />
                  ) : (
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-muted-foreground transition-colors duration-[--motion-duration-base] group-hover:bg-[hsl(var(--tone))] group-hover:text-[hsl(var(--tone-foreground))] group-focus-visible:bg-[hsl(var(--tone))] group-focus-visible:text-[hsl(var(--tone-foreground))]">
                      <ArrowRight className="size-4 transition-transform duration-[--motion-duration-base] group-hover:translate-x-0.5" />
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </AppModalShell>
      <UploadCreationFlow open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}

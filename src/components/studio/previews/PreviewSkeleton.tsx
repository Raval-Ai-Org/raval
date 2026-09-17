"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Check, Sparkles } from "@/components/icons";
import { cn } from "@/lib/utils";
import { duration, ease } from "@/lib/motion";
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { RATIOS, type AspectRatio } from "@/lib/studio/aspect";
import { STUDIO_FORMATS, type StageId } from "@/lib/studio/formats";
import { GOALS } from "@/lib/studio/jobs";
import type { StudioSession } from "@/lib/studio/session-store";
import type { StudioTemplate } from "@/lib/studio/templates";
import { RatioFrame, Weave } from "../studio-ui";
import { usePreviewBrand } from "./brand";

type LineState = "idle" | "writing" | "done";

/** A line of text-to-be. It waits faintly, writes itself in, then settles. */
function Line({
  w,
  state,
  delay = 0,
  thick = false,
  className,
}: {
  w: string;
  state: LineState;
  delay?: number;
  thick?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const base = cn(
    "relative block overflow-hidden rounded-full",
    thick ? "h-3" : "h-2",
    state === "idle" ? "bg-foreground/[0.07]" : "bg-foreground/[0.14]",
    className,
  );
  if (state !== "writing") return <span className={base} style={{ width: w }} />;
  return (
    <motion.span
      key="writing"
      className={base}
      initial={reduce ? false : { width: 0, opacity: 0.4 }}
      animate={{ width: w, opacity: 1 }}
      transition={{ delay, duration: 0.9, ease: ease.emphasized }}
    >
      <Weave />
    </motion.span>
  );
}

/** A template beat label pinned to the block it describes. */
function Beat({ label, className }: { label?: string; className?: string }) {
  if (!label) return null;
  return (
    <motion.span
      key={label}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 26 }}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full bg-[hsl(var(--tone)/0.14)] px-1.5 py-px text-[9px] font-semibold uppercase leading-4 tracking-wide text-[hsl(var(--tone))] ring-1 ring-[hsl(var(--tone)/0.28)]",
        className,
      )}
    >
      {label}
    </motion.span>
  );
}

/** Real draft text arriving: revealed left to right, once (CSS, so it always finishes). */
function Reveal({ text, className }: { text: string; className?: string }) {
  return (
    <span
      key={text}
      className={cn("studio-reveal block", className)}
      style={
        {
          "--reveal-duration": `${Math.min(1.8, 0.4 + text.length * 0.012)}s`,
        } as React.CSSProperties
      }
    >
      {text}
    </span>
  );
}

/**
 * The result taking shape. With `stageIndex` ≥ 0 it follows a running job:
 * brand signals gather, structure appears, lines write in, real draft text
 * replaces them as it arrives, and the visual develops.
 *
 * With `stageIndex` of -1 it is a blueprint for the brief step: the chosen
 * platform, size, length and template structure, updating as settings change.
 */
export function PreviewSkeleton({
  session,
  stageIndex,
  platform: platformProp,
  template,
}: {
  session: StudioSession;
  stageIndex: number;
  platform?: PlatformId;
  template?: StudioTemplate | null;
}) {
  const format = STUDIO_FORMATS[session.type];
  const brand = usePreviewBrand(session.workspaceId);
  const blueprint = stageIndex < 0;
  const ids = format.stages.map((s) => s.id);
  const current: StageId | null = stageIndex >= 0 ? (ids[stageIndex] ?? null) : null;
  const at = (id: StageId) => ids.indexOf(id);
  /** idle before the stage, writing during it, done after. */
  const phase = (id: StageId): LineState => {
    const i = at(id);
    if (i < 0 || stageIndex < 0) return "idle";
    return stageIndex > i ? "done" : stageIndex === i ? "writing" : "idle";
  };
  const reached = (id: StageId) => at(id) >= 0 && stageIndex >= at(id);
  const textStage: StageId = ids.includes("captions") ? "captions" : "writing";
  const ratio: AspectRatio = session.controls.ratio ?? format.ratios[0] ?? "1:1";
  const hasMedia =
    format.media === "image" ||
    format.media === "video" ||
    (format.media === "optional-image" && !!session.controls.includeImage);
  const knowsBrand = blueprint || stageIndex > 0;
  const platform = platformProp ?? session.controls.platforms[0];
  const beats = template?.beats ?? [];
  const beat = (i: number) => beats[i < 0 ? beats.length + i : i];
  // Real draft fields, as a running job saves them.
  const out = blueprint ? {} : (session.job?.output ?? {});

  let artifact: React.ReactNode;

  if (session.type === "article") {
    const count = { short: 2, standard: 3, long: 4 }[session.controls.length ?? "standard"];
    const sections = [
      ["38%", "96%", "90%", "72%"],
      ["44%", "92%", "84%"],
      ["30%", "94%", "88%", "60%"],
      ["40%", "90%", "78%"],
    ].slice(0, count);
    const title = out.article?.title ?? out.title;
    artifact = (
      <div className="w-full max-w-[520px] rounded-2xl bg-surface-3 px-8 py-9 shadow-3 ring-1 ring-border/70">
        <div className="flex items-center gap-2">
          <Avatar initial={brand.initial} show={knowsBrand} size={18} />
          <NameLine name={brand.name} show={knowsBrand} />
          <Beat label={beat(0)} className="ml-auto" />
        </div>
        <div className="mt-5 space-y-2.5">
          {title ? (
            <Reveal
              text={title}
              className="text-[19px] font-semibold leading-snug tracking-tight text-foreground"
            />
          ) : (
            <>
              <Line w="88%" thick state={reached("outline") ? "done" : phase("context")} />
              <Line
                w="56%"
                thick
                state={reached("outline") ? "done" : phase("context")}
                delay={0.2}
              />
            </>
          )}
          {out.article?.dek ? (
            <Reveal
              text={out.article.dek}
              className="text-[13px] leading-snug text-muted-foreground"
            />
          ) : null}
        </div>
        <div className="mt-6 space-y-6">
          {sections.map((lines, s) => {
            const outlined = blueprint || reached("outline");
            return (
              <div key={s} className="space-y-2">
                <div className="flex items-center gap-2">
                  <motion.span
                    className="h-3 w-1 rounded-full bg-primary"
                    initial={false}
                    animate={{ opacity: outlined ? 1 : 0.15, scaleY: outlined ? 1 : 0.5 }}
                    transition={{
                      delay: outlined && !blueprint ? s * 0.35 : 0,
                      duration: duration.slow,
                    }}
                  />
                  <Line w={lines[0]} state={phase("outline") === "idle" ? "idle" : "done"} />
                  <Beat
                    label={beats.length > 1 ? beat(Math.min(s + 1, beats.length - 1)) : undefined}
                  />
                </div>
                {lines.slice(1).map((w, i) => (
                  <Line key={i} w={w} state={phase("writing")} delay={s * 0.9 + i * 0.3} />
                ))}
              </div>
            );
          })}
        </div>
      </div>
    );
  } else if (session.type === "script") {
    const rows = 4;
    const seconds = session.controls.durationSec ?? 30;
    const hook = out.script?.hook;
    artifact = (
      <div className="w-full max-w-[520px] rounded-2xl bg-surface-3 p-6 shadow-3 ring-1 ring-border/70">
        <div className="flex items-center justify-between gap-3">
          {out.script?.title || out.title ? (
            <Reveal
              text={(out.script?.title ?? out.title)!}
              className="truncate text-[15px] font-semibold text-foreground"
            />
          ) : (
            <Line w="46%" thick state={reached("angle") ? "done" : phase("context")} />
          )}
          <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {seconds}s
          </span>
        </div>
        <div className="mt-3 flex h-1.5 gap-1 overflow-hidden rounded-full">
          {Array.from({ length: rows }).map((_, i) => (
            <motion.span
              key={i}
              className="h-full flex-1 rounded-full"
              initial={false}
              animate={{
                backgroundColor:
                  (i === 0 && reached("angle")) || (i > 0 && reached("polish"))
                    ? "hsl(var(--primary))"
                    : "hsl(var(--foreground) / 0.08)",
              }}
              transition={{ delay: i * 0.15, duration: duration.slow }}
            />
          ))}
        </div>
        <ol className="mt-4 space-y-2.5">
          {Array.from({ length: rows }).map((_, i) => {
            const state = i === 0 ? phase("angle") : phase("writing");
            const settled = i === 0 ? reached("writing") : reached("polish");
            return (
              <li
                key={i}
                className={cn(
                  "grid grid-cols-[2.25rem_3.25rem_1fr] items-center gap-3 rounded-xl p-2 transition-colors duration-[--motion-duration-slow]",
                  i === 0 && state !== "idle" ? "bg-primary-surface" : "bg-surface-2/60",
                )}
              >
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {i === 0
                    ? "0:00"
                    : `0:${String(Math.round((i / rows) * seconds)).padStart(2, "0")}`}
                </span>
                <span className="relative aspect-[9/12] overflow-hidden rounded-md bg-foreground/[0.06]">
                  {state === "writing" ? <Weave /> : null}
                </span>
                <span className="min-w-0 space-y-1.5">
                  {beat(i) ? <Beat label={beat(i)} /> : null}
                  {i === 0 && hook ? (
                    <Reveal
                      text={hook}
                      className="line-clamp-2 text-[12px] font-medium leading-snug text-foreground"
                    />
                  ) : (
                    <>
                      <Line
                        w="90%"
                        state={settled ? "done" : state}
                        delay={(i > 0 ? i - 1 : 0) * 0.5}
                      />
                      <Line
                        w="62%"
                        state={settled ? "done" : state}
                        delay={(i > 0 ? i - 1 : 0) * 0.5 + 0.25}
                      />
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    );
  } else if (session.type === "carousel") {
    const slides = session.controls.slideCount ?? 6;
    const designed = phase("polish") !== "idle";
    const heading = out.slides?.[0]?.heading;
    artifact = (
      <div className="flex w-full max-w-[400px] flex-col items-center">
        <div className="relative w-[78%]">
          {[2, 1].map((k) => (
            <span
              key={k}
              aria-hidden
              className="absolute inset-0 rounded-xl bg-surface-3 shadow-2 ring-1 ring-border/70"
              style={{
                transform: `translate(${k * 14}px, ${k * -4}px) rotate(${k * 3}deg)`,
                opacity: 1 - k * 0.28,
              }}
            />
          ))}
          <RatioFrame
            ratio={ratio}
            maxHeight={440}
            className="rounded-xl shadow-3 ring-1 ring-border/70"
          >
            <motion.div
              className="absolute inset-0 flex flex-col p-[9%]"
              initial={false}
              animate={{
                backgroundColor: designed ? "hsl(var(--primary-surface))" : "hsl(var(--surface-3))",
              }}
              transition={{ duration: duration.xslow, ease: ease.emphasized }}
            >
              <div className="flex items-center justify-between gap-2">
                <NameLine name={brand.name} show={knowsBrand} />
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  1/{slides}
                </span>
              </div>
              <div className="mt-auto space-y-2.5">
                <Beat label={beat(0)} />
                {heading ? (
                  <Reveal
                    text={heading}
                    className="text-[22px] font-semibold leading-[1.1] tracking-tight text-foreground"
                  />
                ) : (
                  <>
                    <Line w="92%" thick state={phase("writing")} />
                    <Line w="70%" thick state={phase("writing")} delay={0.3} />
                  </>
                )}
                <div className="pt-1.5">
                  <Line w="80%" state={phase("writing")} delay={0.7} />
                </div>
              </div>
              {designed ? (
                <motion.span
                  className="mt-4 h-1 w-10 rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: 40 }}
                  transition={{ duration: duration.xslow, ease: ease.emphasized }}
                />
              ) : null}
            </motion.div>
          </RatioFrame>
        </div>
        <div className="mt-6 flex items-center gap-1.5" aria-hidden>
          {Array.from({ length: slides }).map((_, i) => (
            <motion.span
              key={i}
              className="h-1.5 rounded-full"
              initial={false}
              animate={{
                width: i === 0 ? 18 : 6,
                backgroundColor:
                  blueprint || reached("outline")
                    ? i === 0
                      ? "hsl(var(--primary))"
                      : "hsl(var(--foreground) / 0.3)"
                    : "hsl(var(--foreground) / 0.08)",
              }}
              transition={{
                delay: reached("outline") && !blueprint ? i * 0.12 : 0,
                duration: duration.medium,
              }}
            />
          ))}
        </div>
        {beats.length ? (
          <div className="mt-3 flex max-w-[360px] flex-wrap justify-center gap-1">
            {beats.slice(0, slides).map((b, i) => (
              <Beat key={`${b}-${i}`} label={`${i + 1} · ${b}`} />
            ))}
          </div>
        ) : null}
      </div>
    );
  } else {
    // Feed formats: social post, image post, ad, video.
    const spec = platform ? PLATFORMS[platform] : null;
    const Icon = spec?.icon;
    const mediaFirst = session.type === "image" || session.type === "video";
    const maxH = session.type === "video" || RATIOS[ratio].h > RATIOS[ratio].w ? 400 : 330;
    const variant = out.variants?.find((x) => x.platform === platform) ?? out.variants?.[0];
    const hook = (variant?.body ?? out.ads?.[0]?.primaryText)?.split("\n").find((l) => l.trim());
    const media = hasMedia ? (
      <MediaStage
        ratio={ratio}
        maxHeight={maxH}
        kind={session.type === "video" ? "video" : "image"}
        planning={phase("brief") === "writing"}
        planned={reached("brief") || reached("writing")}
        developing={current === "render"}
        developed={reached("save")}
        saved={stageIndex > at("save") && at("save") >= 0}
        shots={session.type === "video" && (blueprint || reached("brief"))}
        idle={blueprint}
        concept={out.concept ?? out.visualConcept}
        seconds={session.type === "video" ? (session.controls.durationSec ?? 6) : undefined}
      />
    ) : null;
    const text = (
      <div className="space-y-2">
        {hook ? (
          <Reveal text={hook} className="line-clamp-3 text-[13px] leading-snug text-foreground" />
        ) : (
          <div className="flex items-center gap-2">
            <Line w="80%" state={phase(textStage)} />
            <Beat label={beat(0)} />
          </div>
        )}
        <Line w="82%" state={hook ? "done" : phase(textStage)} delay={0.3} />
        <div className="flex items-center gap-2">
          <Line w="48%" state={hook ? "done" : phase(textStage)} delay={0.6} />
          {beats.length > 1 ? <Beat label={beat(-1)} /> : null}
        </div>
      </div>
    );
    artifact = (
      <div className="w-full max-w-[440px] rounded-2xl bg-surface-3 p-5 shadow-3 ring-1 ring-border/70">
        <div className="flex items-center gap-2.5">
          <Avatar initial={brand.initial} show={knowsBrand} size={34} />
          <div className="min-w-0 flex-1 space-y-1">
            <NameLine name={brand.name} show={knowsBrand} strong />
            <motion.span
              key={platform ?? "none"}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-center gap-1 text-[11px] text-muted-foreground"
            >
              {Icon ? <Icon className="size-3" /> : null}
              {session.type === "ad" ? "Sponsored" : (spec?.label ?? format.label)}
            </motion.span>
          </div>
        </div>
        {mediaFirst ? (
          <>
            <div className="mt-3.5">{media}</div>
            <div className="mt-3.5">{text}</div>
          </>
        ) : (
          <>
            <div className="mt-3.5">{text}</div>
            {media ? <div className="mt-3.5">{media}</div> : null}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col items-center gap-6" aria-hidden>
      {stageIndex >= 0 ? (
        <Signals
          session={session}
          stageIndex={stageIndex}
          brandName={brand.name}
          template={template}
        />
      ) : null}
      <motion.div
        layout={blueprint}
        transition={{ duration: duration.slow, ease: ease.emphasized }}
        className={cn("flex w-full justify-center", stageIndex >= 0 && "studio-float")}
      >
        {artifact}
      </motion.div>
    </div>
  );
}

function Avatar({ initial, show, size }: { initial: string; show: boolean; size: number }) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center rounded-full text-[10px] font-semibold transition-colors duration-[--motion-duration-slow]",
        show
          ? "bg-primary-surface text-foreground/80 ring-1 ring-primary-border"
          : "bg-foreground/[0.06]",
      )}
      style={{ width: size, height: size }}
    >
      {show ? initial : null}
    </span>
  );
}

function NameLine({ name, show, strong }: { name: string; show: boolean; strong?: boolean }) {
  return show ? (
    <motion.span
      key="name"
      initial={{ opacity: 0, filter: "blur(4px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: duration.slow }}
      className={cn(
        "block truncate text-[12px] leading-none text-foreground",
        strong ? "font-semibold" : "font-medium",
      )}
    >
      {name}
    </motion.span>
  ) : (
    <span className="block">
      <Line w="42%" state="idle" />
    </span>
  );
}

/** The visual slot through planning, developing, and saving. */
function MediaStage({
  ratio,
  maxHeight,
  kind,
  planning,
  planned,
  developing,
  developed,
  saved,
  shots,
  idle,
  concept,
  seconds,
}: {
  ratio: AspectRatio;
  maxHeight: number;
  kind: "image" | "video";
  planning: boolean;
  planned: boolean;
  developing: boolean;
  developed: boolean;
  saved: boolean;
  shots: boolean;
  idle: boolean;
  concept?: string;
  seconds?: number;
}) {
  const label = saved
    ? "Saved to Library"
    : developed
      ? "Saving to Library"
      : developing
        ? kind === "video"
          ? "Rendering frames"
          : "Developing visual"
        : planning
          ? "Composing the shot"
          : idle
            ? `${RATIOS[ratio].label} ${ratio}${seconds ? ` · ${seconds}s` : ""}`
            : `${kind === "video" ? "Video" : "Visual"} · ${ratio}`;
  return (
    <div>
      <RatioFrame
        ratio={ratio}
        maxHeight={maxHeight}
        className={cn(
          "rounded-xl transition-[background-color] duration-[--motion-duration-xslow]",
          developing ? "studio-develop" : developed ? "bg-primary-surface" : "bg-foreground/[0.05]",
        )}
      >
        {/* Art direction: a composition grid draws in while the brief is built. */}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 size-full text-foreground/15"
        >
          {[33.33, 66.66].map((v, i) => (
            <g key={v}>
              <motion.line
                x1={v}
                y1="0"
                x2={v}
                y2="100"
                stroke="currentColor"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={{
                  pathLength: (planned || idle) && !developed ? 1 : 0,
                  opacity: (planned || idle) && !developed ? 1 : 0,
                }}
                transition={{ delay: i * 0.25, duration: 0.9, ease: ease.emphasized }}
              />
              <motion.line
                x1="0"
                y1={v}
                x2="100"
                y2={v}
                stroke="currentColor"
                strokeWidth="0.4"
                vectorEffect="non-scaling-stroke"
                initial={false}
                animate={{
                  pathLength: (planned || idle) && !developed ? 1 : 0,
                  opacity: (planned || idle) && !developed ? 1 : 0,
                }}
                transition={{ delay: 0.4 + i * 0.25, duration: 0.9, ease: ease.emphasized }}
              />
            </g>
          ))}
        </svg>
        {planning ? <Weave /> : null}
        {concept ? (
          <div className="absolute inset-x-0 top-0 p-3">
            <Reveal
              text={concept}
              className="line-clamp-3 rounded-lg bg-surface-3/85 px-2.5 py-1.5 text-[11px] leading-snug text-foreground/85 shadow-1 backdrop-blur"
            />
          </div>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-2.5">
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: duration.medium, ease: ease.emphasized }}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface-3/90 px-2.5 py-1 text-[10.5px] font-medium text-foreground/75 shadow-1 backdrop-blur"
          >
            {developed ? <Check className="size-3 text-primary" strokeWidth={3} /> : null}
            {label}
          </motion.span>
        </div>
      </RatioFrame>
      {kind === "video" ? (
        <div className="mt-2 flex gap-1.5">
          {[0, 1, 2, 3].map((i) => (
            <motion.span
              key={i}
              className="relative h-6 flex-1 overflow-hidden rounded-md bg-foreground/[0.06]"
              initial={false}
              animate={{ opacity: shots ? 1 : 0.35 }}
              transition={{ delay: shots && !idle ? i * 0.2 : 0, duration: duration.slow }}
            >
              {developing ? (
                <motion.span
                  className="absolute inset-y-0 left-0 bg-primary/35"
                  initial={{ width: "0%" }}
                  animate={{ width: "100%" }}
                  transition={{
                    delay: i * 2.5,
                    duration: 2.5,
                    ease: "linear",
                    repeat: Infinity,
                    repeatDelay: 7.5,
                  }}
                />
              ) : null}
            </motion.span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** What Mellox gathered before writing a word. */
function Signals({
  session,
  stageIndex,
  brandName,
  template,
}: {
  session: StudioSession;
  stageIndex: number;
  brandName: string;
  template?: StudioTemplate | null;
}) {
  const gathering = stageIndex === 0;
  const goal = GOALS.find((g) => g.id === session.goal)?.label;
  const items: { key: string; label: React.ReactNode }[] = [
    {
      key: "brand",
      label: brandName === "Your brand" ? "Brand voice" : `${brandName} voice`,
    },
    ...(template ? [{ key: "template", label: `Template · ${template.label}` }] : []),
    ...(goal ? [{ key: "goal", label: `Goal · ${goal}` }] : []),
    ...session.controls.platforms.slice(0, 3).map((p) => {
      const Icon = PLATFORMS[p].icon;
      return {
        key: p,
        label: (
          <>
            <Icon className="size-3" />
            {PLATFORMS[p].label}
          </>
        ),
      };
    }),
    { key: "recent", label: "Recent posts" },
  ];
  return (
    <ul className="flex max-w-[460px] flex-wrap justify-center gap-1.5">
      {items.map((item, i) => (
        <motion.li
          key={item.key}
          initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{
            delay: gathering ? 0.3 + i * 0.45 : i * 0.05,
            duration: duration.slow,
            ease: ease.emphasized,
          }}
          className={cn(
            "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium transition-colors duration-[--motion-duration-slow]",
            gathering
              ? "bg-surface-3 text-foreground shadow-1 ring-1 ring-border"
              : "bg-surface-3/70 text-muted-foreground ring-1 ring-border/60",
          )}
        >
          {gathering ? (
            <Sparkles className="size-3 text-primary" />
          ) : (
            <Check className="size-3 text-primary" strokeWidth={3} />
          )}
          {item.label}
        </motion.li>
      ))}
    </ul>
  );
}

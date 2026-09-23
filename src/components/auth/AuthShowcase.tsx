"use client";

/**
 * The product showcase on the left of the sign-in screens.
 *
 * A light stage that plays four short scenes of Mellox at work, drawn as
 * interface cards rather than a video: write a post on brand, get found in AI
 * answers, schedule the week, see what grew. Each scene runs ~6.5s and hands
 * over with a soft blur, the way Apple and Lovable present product.
 *
 * Nothing is fetched. Reduced-motion users get the first scene, fully drawn,
 * with no cycling.
 */

import { AnimatePresence, animate, motion, type TargetAndTransition } from "framer-motion";
import { useEffect, useState, type ReactNode } from "react";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { ArrowUp, Calendar, Check, Sparkles, TrendingUp } from "@/components/icons";
import { ease } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SCENE_MS = 6500;
const EASE = [...ease.emphasized] as [number, number, number, number];

/* Fixed light palette: the stage is light in both app themes. */
const INK = "text-[#15190f]";
const MUTED = "text-[#6b7263]";
const MOSS = "#2f6b08";
const LIME = "#d2e861";

type SceneProps = { reduce: boolean };

const SCENES: { label: string; Scene: (p: SceneProps) => ReactNode }[] = [
  { label: "Create", Scene: CreateScene },
  { label: "Get found", Scene: VisibilityScene },
  { label: "Publish", Scene: PublishScene },
  { label: "Grow", Scene: GrowScene },
];

export function AuthShowcase({ reduce }: { reduce: boolean }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = window.setTimeout(() => setIndex((i) => (i + 1) % SCENES.length), SCENE_MS);
    return () => window.clearTimeout(id);
  }, [index, reduce]);

  const { Scene } = SCENES[index];

  return (
    <div
      aria-hidden
      className="absolute inset-3 isolate overflow-hidden rounded-[28px] bg-[#f3f5ec] text-[#15190f] ring-1 ring-inset ring-black/[0.05]"
    >
      <Backdrop reduce={reduce} />

      <div className="relative flex h-full items-center justify-center px-10 pb-16">
        <motion.div
          className="relative w-full max-w-[468px]"
          animate={reduce ? undefined : { y: [0, -6, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Scenes share one grid cell so the next one fades in while the last
              fades out — no empty frame between them. */}
          <div className="grid min-h-[470px] items-center">
            <AnimatePresence initial={false}>
              <motion.div
                key={index}
                className="[grid-area:1/1]"
                initial={reduce ? false : { opacity: 0, y: 18, scale: 0.985, filter: "blur(10px)" }}
                animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                exit={{
                  opacity: 0,
                  y: -14,
                  scale: 0.985,
                  filter: "blur(10px)",
                  transition: { duration: 0.5, ease: EASE },
                }}
                transition={{ duration: 0.8, delay: 0.15, ease: EASE }}
              >
                <Scene reduce={reduce} />
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      </div>

      <Progress index={index} reduce={reduce} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stage                                                               */
/* ------------------------------------------------------------------ */

function Backdrop({ reduce }: { reduce: boolean }) {
  const drift = (x: number[], y: number[], seconds: number) =>
    reduce
      ? {}
      : {
          animate: { x, y },
          transition: { duration: seconds, repeat: Infinity, ease: "easeInOut" as const },
        };
  return (
    <>
      <motion.div
        className="absolute -left-[25%] -top-[30%] h-[80%] w-[80%] rounded-full"
        style={{ background: `radial-gradient(closest-side, ${LIME}73, transparent)` }}
        {...drift([0, 50, 0], [0, 30, 0], 22)}
      />
      <motion.div
        className="absolute -bottom-[30%] -right-[25%] h-[85%] w-[85%] rounded-full"
        style={{ background: "radial-gradient(closest-side, #cfe7c2b3, transparent)" }}
        {...drift([0, -40, 0], [0, -30, 0], 28)}
      />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage: "radial-gradient(rgba(21,25,15,0.09) 1px, transparent 1px)",
          backgroundSize: "20px 20px",
          maskImage: "radial-gradient(ellipse 65% 55% at 50% 45%, #000 20%, transparent 80%)",
          WebkitMaskImage: "radial-gradient(ellipse 65% 55% at 50% 45%, #000 20%, transparent 80%)",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background: "radial-gradient(45% 35% at 50% 45%, rgba(255,255,255,0.75), transparent)",
        }}
      />
    </>
  );
}

function Progress({ index, reduce }: { index: number; reduce: boolean }) {
  return (
    <div className="absolute inset-x-0 bottom-8 flex justify-center">
      <div className="flex items-center gap-5 rounded-full bg-white/70 px-5 py-2.5 shadow-[0_1px_2px_rgba(16,24,8,0.05),0_8px_24px_-12px_rgba(16,24,8,0.2)] ring-1 ring-black/[0.05] backdrop-blur">
        {SCENES.map((s, i) => (
          <div key={s.label} className="flex w-[64px] flex-col items-center gap-1.5">
            <span
              className={cn(
                "text-[11.5px] font-medium transition-colors duration-500",
                i === index ? INK : "text-[#9aa092]",
              )}
            >
              {s.label}
            </span>
            <span className="relative h-[3px] w-full overflow-hidden rounded-full bg-black/[0.07]">
              {i === index && (
                <motion.span
                  key={index}
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{ background: MOSS }}
                  initial={{ width: reduce ? "100%" : "0%" }}
                  animate={{ width: "100%" }}
                  transition={{ duration: reduce ? 0 : SCENE_MS / 1000, ease: "linear" }}
                />
              )}
              {i < index && <span className="absolute inset-0 rounded-full bg-black/[0.18]" />}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-[20px] bg-white ring-1 ring-black/[0.06]",
        "shadow-[0_1px_2px_rgba(16,24,8,0.04),0_20px_44px_-16px_rgba(16,24,8,0.2)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Entrance props: fade and rise after `delay`, or already in place when reduced. */
function enter(
  reduce: boolean,
  delay: number,
  from: TargetAndTransition = { opacity: 0, y: 12 },
  duration = 0.6,
) {
  if (reduce) return { initial: false as const };
  return {
    initial: from,
    animate: { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" },
    transition: { delay, duration, ease: EASE },
  };
}

const pop = (reduce: boolean, delay: number) =>
  reduce
    ? { initial: false as const }
    : {
        initial: { opacity: 0, scale: 0.4 },
        animate: { opacity: 1, scale: 1 },
        transition: { delay, type: "spring" as const, stiffness: 420, damping: 22 },
      };

function useTyped(text: string, startMs: number, perCharMs: number, reduce: boolean) {
  const [count, setCount] = useState(reduce ? text.length : 0);
  useEffect(() => {
    if (reduce) return;
    let iv = 0;
    const t = window.setTimeout(() => {
      let i = 0;
      iv = window.setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length) window.clearInterval(iv);
      }, perCharMs);
    }, startMs);
    return () => {
      window.clearTimeout(t);
      window.clearInterval(iv);
    };
  }, [text, startMs, perCharMs, reduce]);
  return { typed: text.slice(0, count), done: count >= text.length };
}

function CountUp({
  to,
  delay = 0,
  duration = 1.6,
  reduce,
  format = (v) => Math.round(v).toString(),
}: {
  to: number;
  delay?: number;
  duration?: number;
  reduce: boolean;
  format?: (v: number) => string;
}) {
  const [value, setValue] = useState(reduce ? to : 0);
  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, to, { delay, duration, ease: EASE, onUpdate: setValue });
    return () => controls.stop();
  }, [to, delay, duration, reduce]);
  return <span className="tabular-nums">{format(value)}</span>;
}

function Logo({ name, size = 14 }: { name: BrandKey; size?: number }) {
  return (
    <span className="grid size-7 place-items-center rounded-full bg-white ring-1 ring-black/[0.07] shadow-[0_2px_6px_-2px_rgba(16,24,8,0.15)]">
      <BrandLogo name={name} brand size={size} />
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 1 — Create: a prompt becomes an on-brand post                 */
/* ------------------------------------------------------------------ */

const PROMPT = "A launch post for our spring collection";
const CAPTION = "Spring is here. Lighter fabrics, fresh colours, and 20% off everything this week.";

function CreateScene({ reduce }: SceneProps) {
  const { typed, done } = useTyped(PROMPT, 450, 34, reduce);
  const words = CAPTION.split(" ");

  return (
    <div className="space-y-3">
      <motion.div {...enter(reduce, 0.05)}>
        <Card className="flex items-center gap-3 p-2.5 pl-3.5">
          <span
            className="grid size-7 shrink-0 place-items-center rounded-full"
            style={{ background: `${LIME}66`, color: MOSS }}
          >
            <Sparkles size={15} />
          </span>
          <p className={cn("min-w-0 flex-1 truncate text-[13.5px]", INK)}>
            {typed}
            {!done && (
              <motion.span
                className="ml-px inline-block h-[15px] w-[1.5px] translate-y-[3px] bg-[#15190f]"
                animate={{ opacity: [1, 0, 1] }}
                transition={{ duration: 0.9, repeat: Infinity }}
              />
            )}
          </p>
          <motion.span
            className="grid size-8 shrink-0 place-items-center rounded-full text-white"
            animate={
              reduce
                ? { backgroundColor: "#15190f" }
                : {
                    backgroundColor: done ? "#15190f" : "#c9cdc2",
                    scale: done ? [1, 0.86, 1] : 1,
                  }
            }
            transition={{ duration: 0.35, delay: done ? 0.15 : 0 }}
          >
            <ArrowUp size={15} />
          </motion.span>
        </Card>
      </motion.div>

      <motion.div {...enter(reduce, 2.2, { opacity: 0, y: 22, scale: 0.97 }, 0.8)}>
        <Card className="p-3.5">
          <div className="flex items-center gap-2.5">
            <span
              className="size-8 rounded-full"
              style={{ background: `linear-gradient(135deg, ${LIME}, #7fb33a)` }}
            />
            <div className="flex-1 space-y-1.5">
              <div className="h-2 w-24 rounded-full bg-[#e6e9df]" />
              <div className="h-2 w-14 rounded-full bg-[#eff1ea]" />
            </div>
            <motion.span
              {...pop(reduce, 4.1)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium"
              style={{ background: `${LIME}59`, color: MOSS }}
            >
              <Check size={12} /> On brand
            </motion.span>
          </div>

          <PostArt reduce={reduce} />

          <p className={cn("mt-3 text-[13px] leading-[1.5]", INK)}>
            {words.map((w, i) => (
              <motion.span
                key={i}
                className="inline-block"
                {...enter(reduce, 2.75 + i * 0.045, { opacity: 0, y: 4, filter: "blur(4px)" }, 0.4)}
              >
                {w}&nbsp;
              </motion.span>
            ))}
          </p>

          <div className="mt-3 flex items-center gap-1.5 border-t border-black/[0.05] pt-3">
            {(["instagram", "linkedin", "x", "tiktok"] as BrandKey[]).map((p, i) => (
              <motion.span key={p} {...pop(reduce, 3.7 + i * 0.1)}>
                <Logo name={p} size={13} />
              </motion.span>
            ))}
            <motion.span
              {...enter(reduce, 4.2, { opacity: 0, x: -6 })}
              className={cn("ml-auto text-[11.5px]", MUTED)}
            >
              Ready for 4 channels
            </motion.span>
          </div>
        </Card>
      </motion.div>
    </div>
  );
}

/** Abstract product art for the generated post — soft shapes, slowly drifting. */
function PostArt({ reduce }: { reduce: boolean }) {
  const float = (y: number[], seconds: number) =>
    reduce
      ? {}
      : {
          animate: { y },
          transition: { duration: seconds, repeat: Infinity, ease: "easeInOut" as const },
        };
  return (
    <div
      className="relative mt-3 aspect-[16/8] overflow-hidden rounded-[14px]"
      style={{ background: "linear-gradient(140deg, #eef5d6 0%, #dcebc0 45%, #f6efd9 100%)" }}
    >
      <motion.div
        className="absolute -left-6 top-6 size-28 rounded-full"
        style={{ background: `radial-gradient(circle at 35% 35%, #f4f9e1, ${LIME})` }}
        {...float([0, -8, 0], 5)}
      />
      <motion.div
        className="absolute right-10 top-4 size-20 rounded-[28%] rotate-12"
        style={{ background: "linear-gradient(160deg, #ffffff, #cfe3b0)" }}
        {...float([0, 7, 0], 6)}
      />
      <motion.div
        className="absolute bottom-[-18px] left-[42%] h-20 w-32 rounded-full"
        style={{ background: "linear-gradient(90deg, #9cc45a, #6d9f2c)", opacity: 0.85 }}
        {...float([0, -5, 0], 7)}
      />
      {!reduce && (
        <motion.div
          className="absolute inset-y-0 w-1/3"
          style={{
            background: "linear-gradient(100deg, transparent, rgba(255,255,255,0.55), transparent)",
          }}
          initial={{ x: "-120%" }}
          animate={{ x: "360%" }}
          transition={{ delay: 2.5, duration: 1.4, ease: "easeInOut" }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Get found: AI visibility score and engine mentions         */
/* ------------------------------------------------------------------ */

const ENGINES: { key: BrandKey; name: string; value: number }[] = [
  { key: "openai", name: "ChatGPT", value: 82 },
  { key: "gemini", name: "Gemini", value: 71 },
  { key: "claude", name: "Claude", value: 76 },
  { key: "google", name: "Google", value: 90 },
];

function VisibilityScene({ reduce }: SceneProps) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const score = 0.86;

  return (
    <div className="relative">
      <motion.div {...enter(reduce, 0.05)}>
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <span className={cn("text-[13px] font-medium", INK)}>AI visibility</span>
            <motion.span
              {...pop(reduce, 2.2)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ background: `${LIME}59`, color: MOSS }}
            >
              <TrendingUp size={12} /> +24
            </motion.span>
          </div>

          <div className="mt-4 flex items-center gap-6">
            <div className="relative size-[116px] shrink-0">
              <svg viewBox="0 0 116 116" className="size-full -rotate-90">
                <defs>
                  <linearGradient id="auth-gauge" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={LIME} />
                    <stop offset="100%" stopColor="#5e9a1c" />
                  </linearGradient>
                </defs>
                <circle cx="58" cy="58" r={R} fill="none" stroke="#eef0e8" strokeWidth="9" />
                <motion.circle
                  cx="58"
                  cy="58"
                  r={R}
                  fill="none"
                  stroke="url(#auth-gauge)"
                  strokeWidth="9"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  initial={{ strokeDashoffset: reduce ? C * (1 - score) : C }}
                  animate={{ strokeDashoffset: C * (1 - score) }}
                  transition={{ delay: 0.4, duration: 1.8, ease: EASE }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center">
                <div className="text-center">
                  <div className={cn("text-[30px] font-semibold leading-none tracking-tight", INK)}>
                    <CountUp to={86} delay={0.4} duration={1.8} reduce={reduce} />
                  </div>
                  <div className={cn("mt-1 text-[10.5px]", MUTED)}>of 100</div>
                </div>
              </div>
            </div>

            <div className="min-w-0 flex-1 space-y-3">
              {ENGINES.map((e, i) => (
                <motion.div
                  key={e.key}
                  {...enter(reduce, 0.5 + i * 0.14, { opacity: 0, x: 10 })}
                  className="flex items-center gap-2.5"
                >
                  <BrandLogo name={e.key} brand size={14} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between">
                      <span className={cn("text-[11.5px] font-medium", INK)}>{e.name}</span>
                      <motion.span {...pop(reduce, 1.9 + i * 0.14)}>
                        <span
                          className="grid size-3.5 place-items-center rounded-full text-white"
                          style={{ background: MOSS }}
                        >
                          <Check size={9} />
                        </span>
                      </motion.span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef0e8]">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: `linear-gradient(90deg, ${LIME}, #6ea62a)` }}
                        initial={{ width: reduce ? `${e.value}%` : "0%" }}
                        animate={{ width: `${e.value}%` }}
                        transition={{ delay: 0.7 + i * 0.14, duration: 1.2, ease: EASE }}
                      />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </Card>
      </motion.div>

      <motion.div
        {...enter(reduce, 3.0, { opacity: 0, y: 16, scale: 0.96 }, 0.7)}
        className="relative z-10 -mt-3 ml-auto w-[82%]"
      >
        <Card className="flex items-center gap-3 p-3">
          <span
            className="grid size-8 shrink-0 place-items-center rounded-xl"
            style={{ background: `${LIME}59`, color: MOSS }}
          >
            <Sparkles size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("truncate text-[12.5px] font-medium", INK)}>Add answers to your FAQ</p>
            <p className={cn("truncate text-[11px]", MUTED)}>Fix ready · 3 pages</p>
          </div>
          <motion.span
            className="rounded-full bg-[#15190f] px-3 py-1.5 text-[11px] font-semibold text-white"
            animate={reduce ? undefined : { scale: [1, 1, 0.92, 1] }}
            transition={{ delay: 4.4, duration: 0.5, times: [0, 0.4, 0.7, 1] }}
          >
            Fix
          </motion.span>
        </Card>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Publish: the week fills itself                            */
/* ------------------------------------------------------------------ */

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const POSTS: { day: number; slot: number; key: BrandKey; tint: string }[] = [
  { day: 0, slot: 0, key: "instagram", tint: "#fde7f0" },
  { day: 1, slot: 1, key: "linkedin", tint: "#e3effb" },
  { day: 2, slot: 0, key: "x", tint: "#eceeea" },
  { day: 2, slot: 2, key: "tiktok", tint: "#e6f7f5" },
  { day: 3, slot: 1, key: "instagram", tint: "#fde7f0" },
  { day: 4, slot: 0, key: "linkedin", tint: "#e3effb" },
  { day: 5, slot: 2, key: "youtube", tint: "#fde8e6" },
  { day: 6, slot: 1, key: "x", tint: "#eceeea" },
];

function PublishScene({ reduce }: SceneProps) {
  return (
    <div className="relative">
      <motion.div {...enter(reduce, 0.05)}>
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <span className={cn("inline-flex items-center gap-2 text-[13px] font-medium", INK)}>
              <Calendar size={15} /> This week
            </span>
            <div className="flex gap-1">
              <span className="size-1.5 rounded-full bg-[#dfe2d8]" />
              <span className="size-1.5 rounded-full bg-[#dfe2d8]" />
              <span className="size-1.5 rounded-full bg-[#dfe2d8]" />
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-7 gap-1.5">
            {DAYS.map((d, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <span className={cn("text-[10.5px] font-medium", MUTED)}>{d}</span>
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-[11px] font-semibold",
                    i === 2 ? "bg-[#15190f] text-white" : INK,
                  )}
                >
                  {12 + i}
                </span>
                <div className="relative grid h-[150px] w-full grid-rows-3 gap-1.5 rounded-xl bg-[#f6f7f2] p-1">
                  {[0, 1, 2].map((slot) => {
                    const post = POSTS.find((p) => p.day === i && p.slot === slot);
                    const order = post ? POSTS.indexOf(post) : 0;
                    return (
                      <div
                        key={slot}
                        className="rounded-lg border border-dashed border-black/[0.06]"
                      >
                        {post && (
                          <motion.div
                            className="flex h-full flex-col items-center justify-center gap-1 rounded-lg ring-1 ring-black/[0.05] shadow-[0_4px_10px_-4px_rgba(16,24,8,0.18)]"
                            style={{ background: post.tint }}
                            {...(reduce
                              ? { initial: false as const }
                              : {
                                  initial: { opacity: 0, y: -28, scale: 0.8 },
                                  animate: { opacity: 1, y: 0, scale: 1 },
                                  transition: {
                                    delay: 0.6 + order * 0.28,
                                    type: "spring" as const,
                                    stiffness: 320,
                                    damping: 20,
                                  },
                                })}
                          >
                            <BrandLogo name={post.key} brand size={13} />
                            <span className="h-1 w-3/5 rounded-full bg-black/[0.12]" />
                          </motion.div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </motion.div>

      <motion.div
        {...enter(reduce, 3.4, { opacity: 0, y: 18, scale: 0.95 }, 0.6)}
        className="absolute -bottom-6 left-1/2 z-10 -translate-x-1/2"
      >
        <div className="flex items-center gap-2.5 whitespace-nowrap rounded-full bg-[#15190f] py-2 pl-2 pr-4 text-[12.5px] font-medium text-white shadow-[0_14px_30px_-10px_rgba(16,24,8,0.5)]">
          <span
            className="grid size-6 place-items-center rounded-full"
            style={{ background: LIME, color: "#15190f" }}
          >
            <Check size={13} />
          </span>
          8 posts scheduled
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 4 — Grow: results come in                                     */
/* ------------------------------------------------------------------ */

const LINE = "M0 112 C 30 108, 50 96, 80 98 S 130 80, 160 74 S 210 58, 240 46 S 290 22, 320 14";
const AREA = `${LINE} L 320 140 L 0 140 Z`;

function GrowScene({ reduce }: SceneProps) {
  return (
    <div className="space-y-3">
      <motion.div {...enter(reduce, 0.05)}>
        <Card className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <span className={cn("text-[12px]", MUTED)}>Reach · last 30 days</span>
              <div
                className={cn("mt-1 text-[30px] font-semibold leading-none tracking-tight", INK)}
              >
                <CountUp
                  to={48.2}
                  delay={0.3}
                  duration={1.8}
                  reduce={reduce}
                  format={(v) => `${v.toFixed(1)}K`}
                />
              </div>
            </div>
            <motion.span
              {...pop(reduce, 1.9)}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11.5px] font-semibold"
              style={{ background: `${LIME}59`, color: MOSS }}
            >
              <TrendingUp size={12} /> +38%
            </motion.span>
          </div>

          <svg viewBox="0 0 320 140" className="mt-4 h-[140px] w-full overflow-visible">
            <defs>
              <linearGradient id="auth-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={LIME} stopOpacity="0.55" />
                <stop offset="100%" stopColor={LIME} stopOpacity="0" />
              </linearGradient>
            </defs>
            {[35, 70, 105].map((y) => (
              <line key={y} x1="0" x2="320" y1={y} y2={y} stroke="#eef0e8" strokeDasharray="3 4" />
            ))}
            <motion.path
              d={AREA}
              fill="url(#auth-area)"
              initial={{ opacity: reduce ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.2, duration: 1 }}
            />
            <motion.path
              d={LINE}
              fill="none"
              stroke="#4f8a14"
              strokeWidth="2.5"
              strokeLinecap="round"
              initial={{ pathLength: reduce ? 1 : 0 }}
              animate={{ pathLength: 1 }}
              transition={{ delay: 0.3, duration: 1.8, ease: EASE }}
            />
            <motion.g {...pop(reduce, 2.0)}>
              {!reduce && (
                <motion.circle
                  cx="320"
                  cy="14"
                  r="6"
                  fill={LIME}
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                  initial={{ scale: 1, opacity: 0 }}
                  animate={{ scale: [1, 2.4], opacity: [0.7, 0] }}
                  transition={{ delay: 2.1, duration: 1.6, repeat: Infinity }}
                />
              )}
              <circle cx="320" cy="14" r="5" fill="#fff" stroke="#4f8a14" strokeWidth="2.5" />
            </motion.g>
          </svg>
        </Card>
      </motion.div>

      <div className="grid grid-cols-2 gap-3">
        <MiniStat
          reduce={reduce}
          delay={1.0}
          label="Clicks"
          to={3.1}
          unit="K"
          bars={[30, 42, 38, 60, 72, 88]}
        />
        <MiniStat
          reduce={reduce}
          delay={1.2}
          label="AI mentions"
          to={212}
          bars={[20, 34, 48, 52, 70, 94]}
        />
      </div>
    </div>
  );
}

function MiniStat({
  reduce,
  delay,
  label,
  to,
  unit = "",
  bars,
}: {
  reduce: boolean;
  delay: number;
  label: string;
  to: number;
  unit?: string;
  bars: number[];
}) {
  return (
    <motion.div {...enter(reduce, delay, { opacity: 0, y: 14 })}>
      <Card className="flex items-end justify-between p-4">
        <div>
          <span className={cn("text-[11.5px]", MUTED)}>{label}</span>
          <div className={cn("mt-1 text-[20px] font-semibold leading-none tracking-tight", INK)}>
            <CountUp
              to={to}
              delay={delay + 0.2}
              reduce={reduce}
              format={(v) => (unit ? `${v.toFixed(1)}${unit}` : Math.round(v).toString())}
            />
          </div>
        </div>
        <div className="flex h-9 items-end gap-[3px]">
          {bars.map((h, i) => (
            <motion.span
              key={i}
              className="w-[5px] origin-bottom rounded-full"
              style={{ height: `${h}%`, background: i === bars.length - 1 ? "#4f8a14" : "#dfe8cc" }}
              initial={{ scaleY: reduce ? 1 : 0 }}
              animate={{ scaleY: 1 }}
              transition={{ delay: delay + 0.3 + i * 0.07, duration: 0.5, ease: EASE }}
            />
          ))}
        </div>
      </Card>
    </motion.div>
  );
}

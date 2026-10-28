"use client";

import type { Ref } from "react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  RefreshCw,
  Sparkles,
  Spinner,
  Wand,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { platformLabel } from "@/lib/goals/decide";
import type { FirstPostBrief } from "@/lib/onboarding/flow";
import type { Product } from "@/lib/products/catalog";
import type { StudioJob } from "@/lib/studio/jobs";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

export type FirstPostState =
  | { status: "idle" }
  | { status: "starting" }
  | { status: "running" | "succeeded"; job: StudioJob }
  | { status: "failed"; error: string; job?: StudioJob };

export type FirstWinStepProps = {
  brandName: string;
  goalLine: string | null;
  briefs: FirstPostBrief[];
  products: Product[];
  productId: string | null;
  platform: string;
  platforms: string[];
  /** "6 credits" — what the three posts cost together. */
  priceLabel: string;
  posts: Record<number, FirstPostState>;
  /** A 402: what to say, and where to get more. */
  billing: { message: string; href: string } | null;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onProduct: (id: string) => void;
  onPlatform: (id: string) => void;
  onStart: () => void;
  onRetry: (n: number) => void;
  onBack: () => void;
  onLibrary: () => void;
  onEnter: () => void;
};

function preview(job: StudioJob | undefined) {
  const variant = job?.output?.variants?.[0];
  const image = job?.output?.media?.find((m) => m.status === "ready" && m.kind === "image");
  return { text: variant?.body ?? "", image: image?.url ?? null };
}

export function FirstWinStep(p: FirstWinStepProps) {
  const started = Object.values(p.posts).some((s) => s.status !== "idle");
  const states = p.briefs.map((b) => p.posts[b.n] ?? { status: "idle" as const });
  const working = states.some((s) => s.status === "starting" || s.status === "running");
  const ready = states.filter((s) => s.status === "succeeded").length;
  const product = p.products.find((x) => x.id === p.productId) ?? null;

  return (
    <div>
      <Eyebrow icon={Sparkles}>First posts</Eyebrow>
      <h1
        ref={p.headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        {ready === p.briefs.length
          ? "Your first posts are ready."
          : started
            ? "Writing your first posts…"
            : `Make ${p.brandName || "your brand"}'s first three posts.`}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Each one has a different job, written from your Brand DNA
        {p.goalLine ? (
          <>
            {" "}
            toward your goal: <span className="text-foreground">{p.goalLine}</span>
          </>
        ) : null}
        . They land in your Library as drafts. Nothing is posted until you approve it.
      </p>

      {!started && (
        <div className="mt-7 flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="ds-label mb-2 block">About</span>
            <select
              value={p.productId ?? ""}
              onChange={(e) => p.onProduct(e.target.value)}
              className="h-11 w-full rounded-[var(--ds-radius-well)] border border-border/70 bg-[var(--ds-well-bg)] px-3.5 text-[14px] outline-none focus:border-primary/50"
            >
              {p.products.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                  {x.images.length ? "" : x.kind === "service" ? "" : " (no photo)"}
                </option>
              ))}
            </select>
          </label>
          <div>
            <span className="ds-label mb-2 block">On</span>
            <div className="flex flex-wrap gap-1.5">
              {p.platforms.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={p.platform === id}
                  onClick={() => p.onPlatform(id)}
                  className={cn(
                    "h-11 rounded-full border px-4 text-[13px] font-medium transition-colors",
                    p.platform === id
                      ? "border-primary/60 bg-primary/10"
                      : "border-border/70 bg-card/70 hover:border-foreground/25",
                  )}
                >
                  {platformLabel(id)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <ol className="mt-7 grid grid-cols-1 gap-3 md:grid-cols-3">
        {p.briefs.map((brief, i) => {
          const state = states[i];
          const job = "job" in state ? state.job : undefined;
          const { text, image } = preview(job);
          return (
            <motion.li
              key={brief.n}
              initial={p.reduce ? { opacity: 0 } : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: duration.slow,
                ease: ease.emphasized,
                delay: p.reduce ? 0 : i * 0.06,
              }}
              className={cn(
                "ds-tile flex min-h-[220px] flex-col overflow-hidden",
                state.status === "succeeded" && "border-primary/40",
              )}
            >
              {image ? (
                <img src={image} alt="" className="aspect-square w-full object-cover" />
              ) : product?.images[0]?.url && !started ? (
                <img
                  src={product.images[0].url}
                  alt=""
                  className="aspect-[16/10] w-full bg-[var(--ds-well-bg)] object-contain p-3"
                />
              ) : null}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-primary">
                    Post {brief.n} · {brief.aimLabel}
                  </span>
                  {state.status === "succeeded" ? (
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                      <Check className="h-3.5 w-3.5" aria-label="Ready" />
                    </span>
                  ) : state.status === "starting" || state.status === "running" ? (
                    <Spinner className="h-4 w-4 animate-spin text-primary" aria-label="Writing" />
                  ) : null}
                </div>
                {text ? (
                  <p className="mt-2.5 line-clamp-6 whitespace-pre-line text-[13px] leading-relaxed">
                    {text}
                  </p>
                ) : state.status === "failed" ? (
                  <div className="mt-2.5 space-y-2.5">
                    <p className="text-[13px] text-destructive">{state.error}</p>
                    <button
                      type="button"
                      onClick={() => p.onRetry(brief.n)}
                      className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                    >
                      <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
                    </button>
                  </div>
                ) : started ? (
                  <div className="mt-3 space-y-2" aria-hidden>
                    <div className="h-2.5 w-11/12 animate-pulse rounded-full bg-[var(--ds-well-bg)]" />
                    <div className="h-2.5 w-4/5 animate-pulse rounded-full bg-[var(--ds-well-bg)]" />
                    <div className="h-2.5 w-2/3 animate-pulse rounded-full bg-[var(--ds-well-bg)]" />
                  </div>
                ) : (
                  <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                    {brief.aim === "act"
                      ? "Shows the problem, the fix, and one small next step."
                      : brief.aim === "save"
                        ? "Something useful people keep for later."
                        : brief.aim === "send"
                          ? "Something people pass to a friend."
                          : brief.aim === "reply"
                            ? "A question your audience has an answer to."
                            : "A small, true moment your audience recognises."}
                  </p>
                )}
                <span className="mt-auto pt-3 text-[11.5px] text-muted-foreground">
                  {platformLabel(brief.platform)}
                </span>
              </div>
            </motion.li>
          );
        })}
      </ol>

      {p.billing && (
        <div
          role="alert"
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warning-surface px-4 py-3"
        >
          <p className="text-[13px] text-warning">{p.billing.message}</p>
          <a href={p.billing.href} className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}>
            See plans
          </a>
        </div>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        {started ? (
          <button
            type="button"
            onClick={p.onLibrary}
            disabled={!ready}
            className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
          >
            Open in Library
          </button>
        ) : (
          <button
            type="button"
            onClick={p.onBack}
            className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back
          </button>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!started ? (
            <>
              <button
                type="button"
                onClick={p.onEnter}
                className={cn(dsGhostBtn, "h-12 px-5 text-[14px]")}
              >
                Later
              </button>
              <button
                type="button"
                disabled={!p.productId}
                onClick={p.onStart}
                className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
              >
                <Wand className="h-4 w-4" aria-hidden /> Make my first 3 posts
                <span
                  data-slot="cost-chip"
                  className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                >
                  {p.priceLabel}
                </span>
              </button>
            </>
          ) : (
            <>
              {working && (
                <span className="text-[12.5px] text-muted-foreground">
                  They keep writing if you go on.
                </span>
              )}
              <button
                type="button"
                onClick={p.onEnter}
                className={cn(working ? dsGhostBtn : dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
              >
                Enter Mellox
                <ArrowRight className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

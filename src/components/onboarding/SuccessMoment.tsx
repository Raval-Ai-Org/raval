"use client";

import type { Ref } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Check } from "@/components/icons";
import { Logo } from "@/components/brand/Logo";
import type { BrandExtractResult } from "@/lib/brand-extract-events";
import { normalizeHex } from "@/lib/color";
import { duration, ease, spring } from "@/lib/motion";
import { BrandMark } from "./ui";
import { hostOf } from "./url";

export function SuccessMoment({
  brand,
  url,
  reduce,
  leaving,
  headingRef,
  onEnter,
}: {
  brand: BrandExtractResult;
  url: string;
  reduce: boolean;
  leaving: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onEnter: () => void;
}) {
  const name = brand.brandName?.trim() || hostOf(url);
  const leadVoice = brand.voice?.split(/[,.;]/)[0]?.trim();
  const facts = [
    brand.industry?.trim() && { label: "Industry", value: brand.industry.trim() },
    leadVoice && { label: "Voice", value: leadVoice },
    brand.audienceTags?.[0]?.trim() && { label: "Audience", value: brand.audienceTags[0].trim() },
  ].filter((fact): fact is { label: string; value: string } => !!fact);
  const swatches = (brand.colors ?? [])
    .map((c) => normalizeHex(c.hex))
    .filter((hex): hex is string => !!hex)
    .slice(0, 5);

  const settle = (from: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, x: from, scale: 0.92 },
    animate: { opacity: 1, x: 0, scale: 1 },
    transition: { duration: duration.xslow, ease: ease.emphasized },
  });
  const after = (delay: number) => ({
    initial: reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: duration.slow, ease: ease.emphasized, delay: reduce ? 0 : delay },
  });

  return (
    <div className="text-center">
      <div className="relative mx-auto flex w-fit items-center">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-56 w-96 -translate-x-1/2 -translate-y-1/2"
          style={{
            background: "radial-gradient(closest-side, hsl(var(--brand) / 0.26), transparent)",
          }}
        />
        <motion.span
          {...settle(28)}
          className="grid h-[72px] w-[72px] place-items-center rounded-[28%] border border-border bg-card shadow-[0_16px_40px_-24px_hsl(var(--foreground)/0.5)]"
        >
          <Logo markOnly height={38} />
        </motion.span>
        <span aria-hidden className="relative mx-3 flex h-7 w-12 items-center sm:mx-4 sm:w-20">
          <motion.span
            className="absolute inset-x-0 top-1/2 h-px origin-center bg-border-strong"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: duration.slow, ease: ease.emphasized, delay: reduce ? 0 : 0.3 }}
          />
          <span className="absolute inset-0 grid place-items-center">
            <motion.span
              className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_0_0_4px_hsl(var(--background))]"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={reduce ? { duration: duration.fast } : { ...spring.control, delay: 0.55 }}
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
            </motion.span>
          </span>
        </span>
        <motion.span
          {...settle(-28)}
          className="rounded-[28%] shadow-[0_16px_40px_-24px_hsl(var(--foreground)/0.5)]"
        >
          <BrandMark sources={[brand.logoUrl, brand.faviconUrl]} name={name} size={72} />
        </motion.span>
      </div>

      <motion.p
        {...after(0.7)}
        className="mt-9 text-[12px] font-semibold uppercase tracking-[0.14em] text-primary"
      >
        Mellox now understands {name}
      </motion.p>
      <motion.h1
        ref={headingRef}
        tabIndex={-1}
        {...after(0.78)}
        className="mt-3 text-[clamp(2rem,5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        Your workspace is ready.
      </motion.h1>
      <motion.p
        {...after(0.86)}
        className="mx-auto mt-3 max-w-md text-[14.5px] leading-relaxed text-muted-foreground"
      >
        From here, every draft, insight and recommendation starts from {name}&rsquo;s Brand DNA.
      </motion.p>

      {(facts.length > 0 || swatches.length > 0) && (
        <motion.div
          {...after(0.95)}
          className="mt-7 flex flex-wrap items-center justify-center gap-2"
        >
          {facts.map((fact) => (
            <span
              key={fact.label}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px]"
            >
              <span className="shrink-0 text-muted-foreground">{fact.label}</span>
              <span className="min-w-0 truncate font-medium">{fact.value}</span>
            </span>
          ))}
          {swatches.length > 0 && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-2"
              aria-label="Brand palette"
            >
              {swatches.map((hex) => (
                <span
                  key={hex}
                  aria-hidden
                  className="h-3.5 w-3.5 rounded-full border border-black/10"
                  style={{ background: hex }}
                />
              ))}
            </span>
          )}
        </motion.div>
      )}

      <motion.div {...after(1.05)}>
        <button
          type="button"
          onClick={onEnter}
          disabled={leaving}
          className="mt-9 inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 text-[14.5px] font-semibold text-primary-foreground shadow-[0_14px_32px_-14px_hsl(var(--primary)/0.85)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-70"
        >
          Enter Mellox <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </motion.div>
    </div>
  );
}

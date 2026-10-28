"use client";

import type { Ref } from "react";
import { ArrowLeft, ArrowRight, PenLine, ShoppingBag, Wrench } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { cn } from "@/lib/utils";
import { Eyebrow } from "./ui";

export type Sells = "products" | "services" | "both";

export type ManualBrand = {
  brandName: string;
  oneLiner: string;
  industry: string;
  sells: Sells;
};

export const emptyManualBrand: ManualBrand = {
  brandName: "",
  oneLiner: "",
  industry: "",
  sells: "products",
};

const SELLS: { id: Sells; label: string; icon: typeof ShoppingBag }[] = [
  { id: "products", label: "Products", icon: ShoppingBag },
  { id: "services", label: "Services", icon: Wrench },
  { id: "both", label: "Both", icon: PenLine },
];

const input =
  "h-12 w-full rounded-[var(--ds-radius-well)] border border-border/70 bg-[var(--ds-well-bg)] px-4 text-[15px] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

/** No website: the few facts Mellox needs, typed by the person. */
export function ManualBrandStep({
  value,
  headingRef,
  onChange,
  onBack,
  onContinue,
}: {
  value: ManualBrand;
  headingRef: Ref<HTMLHeadingElement>;
  onChange: (patch: Partial<ManualBrand>) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const ready = value.brandName.trim().length > 1 && value.oneLiner.trim().length > 5;
  return (
    <div>
      <Eyebrow icon={PenLine}>Your brand</Eyebrow>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        Tell Mellox about your brand.
      </h1>
      <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        No website yet is fine. Three answers are enough to start, and you can add more in Brain.
      </p>

      <form
        className="mt-8 space-y-5"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onContinue();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">Brand name</span>
          <input
            autoFocus
            value={value.brandName}
            maxLength={100}
            onChange={(e) => onChange({ brandName: e.target.value })}
            placeholder="e.g. Northwind Coffee"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">What you do, in one line</span>
          <input
            value={value.oneLiner}
            maxLength={200}
            onChange={(e) => onChange({ oneLiner: e.target.value })}
            placeholder="e.g. Small-batch coffee roasted in Leeds, delivered weekly"
            className={input}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium">
            Industry <span className="font-normal text-muted-foreground">(optional)</span>
          </span>
          <input
            value={value.industry}
            maxLength={80}
            onChange={(e) => onChange({ industry: e.target.value })}
            placeholder="e.g. Food & drink"
            className={input}
          />
        </label>
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium">What do you sell?</legend>
          <div role="radiogroup" className="grid grid-cols-3 gap-2">
            {SELLS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={value.sells === id}
                onClick={() => onChange({ sells: id })}
                className={cn(
                  "ds-tile flex h-14 items-center justify-center gap-2 text-[14px] font-medium transition-colors",
                  value.sells === id
                    ? "border-primary/60 bg-primary/[0.07]"
                    : "ds-tile-hover text-foreground/80",
                )}
              >
                <Icon className="h-4 w-4 text-primary" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <button
            type="button"
            onClick={onBack}
            className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> I have a website
          </button>
          <button
            type="submit"
            disabled={!ready}
            className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
          >
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </form>
    </div>
  );
}

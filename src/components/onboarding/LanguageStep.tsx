"use client";

import { useMemo, useState, type Ref } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, Search } from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { MoxSpeech } from "@/components/app/surface/MoxParts";
import { CONTENT_LANGUAGES, searchLanguages } from "@/lib/brand-look/languages";
import { LanguageFlag } from "@/components/brand/LanguageFlag";
import { cn } from "@/lib/utils";

/**
 * "What language should I write in?" (Mellox 2.0, Holo's flag grid). The
 * choice is the brand's content language, stored on the look; the app itself
 * stays in English. Presentational: OnboardingPage saves it.
 */
export function LanguageStep({
  value,
  saving,
  headingRef,
  onChange,
  onBack,
  onContinue,
}: {
  value: string;
  saving?: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
  onChange: (language: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <MoxSpeech pose="wave" size={110}>
        Which language should I <b>write your posts in?</b>
      </MoxSpeech>
      <h1 ref={headingRef} tabIndex={-1} className="sr-only outline-none">
        Choose your content language
      </h1>

      <LanguageGrid value={value} onChange={onChange} className="mt-7" />

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={saving}
          className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px] disabled:opacity-60")}
        >
          {saving ? "Saving…" : "Continue"} <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** The search pill and language grid, shared by onboarding and Settings. */
export function LanguageGrid({
  value,
  onChange,
  className,
  listClassName = "max-h-[46dvh]",
}: {
  value: string;
  onChange: (language: string) => void;
  className?: string;
  listClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => searchLanguages(query), [query]);

  return (
    <div className={className}>
      <label className="flex h-11 items-center gap-2 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] px-4 shadow-[var(--ds-card-shadow)] focus-within:ring-2 focus-within:ring-primary/40">
        <Search className="size-4 text-muted-foreground" aria-hidden />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search languages"
          aria-label="Search languages"
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-muted-foreground"
        />
      </label>

      <ul
        role="radiogroup"
        aria-label="Content language"
        className={cn(
          "mt-4 grid grid-cols-2 gap-2 overflow-y-auto p-0.5 sm:grid-cols-3 md:grid-cols-4",
          listClassName,
        )}
      >
        {list.map((l, i) => {
          const on = l.label === value;
          return (
            <li key={l.code}>
              <motion.button
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange(l.label)}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i, 16) * 0.015, duration: 0.25 }}
                whileTap={{ scale: 0.97 }}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3 py-2 text-left transition",
                  on
                    ? "border-transparent bg-[var(--mox-ink)] text-white shadow-[0_10px_24px_-14px_rgb(22_25_27/0.6)] dark:bg-white dark:text-[var(--mox-ink)]"
                    : "border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] hover:-translate-y-px hover:shadow-[var(--ds-card-shadow)]",
                )}
              >
                <span aria-hidden className="relative shrink-0">
                  <LanguageFlag
                    country={l.country}
                    className={cn(
                      "size-9 transition-transform duration-300",
                      on &&
                        "ring-2 ring-[var(--mox-green)] ring-offset-2 ring-offset-[var(--mox-ink)] dark:ring-offset-white",
                    )}
                  />
                  {on && (
                    <motion.span
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 18 }}
                      className="ds-grad-pill absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full"
                    >
                      <Check className="size-2.5" strokeWidth={3.5} />
                    </motion.span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-semibold">{l.native}</span>
                  {l.native !== l.label && (
                    <span
                      className={cn(
                        "block truncate text-[11px]",
                        on ? "opacity-70" : "text-muted-foreground",
                      )}
                    >
                      {l.label}
                    </span>
                  )}
                </span>
              </motion.button>
            </li>
          );
        })}
        {!list.length && (
          <li className="col-span-full py-6 text-center text-[13px] text-muted-foreground">
            No language matches “{query}”. Try its English name.
          </li>
        )}
      </ul>
    </div>
  );
}

/** The browser's language as a content language, else English. */
export function browserContentLanguage(): string {
  if (typeof navigator === "undefined") return "English";
  const tag = navigator.language || "";
  const exact = CONTENT_LANGUAGES.find((l) => l.code.toLowerCase() === tag.toLowerCase());
  const base = CONTENT_LANGUAGES.find((l) => l.code === tag.split("-")[0]);
  return (exact ?? base)?.label ?? "English";
}

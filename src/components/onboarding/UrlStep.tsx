"use client";

import { useEffect, useState, type Ref } from "react";
import { motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  Compass,
  Globe,
  Megaphone,
  Palette,
  Sparkles,
  Target,
  Users,
} from "@/components/icons";
import { duration, ease } from "@/lib/motion";
import { faviconFor } from "@/lib/site-screenshot";
import { Eyebrow } from "./ui";
import { hostOf, validUrl } from "./url";

const LEARNS = [
  { icon: Palette, label: "Visual identity" },
  { icon: Megaphone, label: "Voice" },
  { icon: Users, label: "Audience" },
  { icon: Target, label: "Positioning" },
  { icon: Compass, label: "Market" },
] as const;

const list: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } },
};
const item: Variants = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: duration.medium, ease: ease.emphasized } },
};
const fadeItem: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast } },
};

export function UrlStep({
  value,
  reduce,
  headingRef,
  onChange,
  onSubmit,
}: {
  value: string;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const valid = validUrl(value);
  const [previewHost, setPreviewHost] = useState<string | null>(null);
  const [brokenIcon, setBrokenIcon] = useState<string | null>(null);

  // Show the site's own icon once the address settles, as quiet confirmation
  // that Mellox is about to read the right site.
  useEffect(() => {
    if (!valid) {
      setPreviewHost(null);
      return;
    }
    const timer = window.setTimeout(() => setPreviewHost(hostOf(value)), 400);
    return () => window.clearTimeout(timer);
  }, [value, valid]);

  const showIcon = previewHost && brokenIcon !== previewHost;

  return (
    <div>
      <Eyebrow icon={Sparkles}>Brand DNA</Eyebrow>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="mt-4 max-w-xl text-[clamp(2.25rem,6vw,3.5rem)] font-semibold leading-[1.02] tracking-[-0.04em] outline-none"
      >
        Let Mellox learn your brand.
      </h1>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
        Share your website. Mellox studies it like a brand strategist would — your look, your voice,
        your audience — and turns it into the Brand DNA behind everything it creates.
      </p>

      <form
        className="mt-8"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit();
        }}
      >
        <motion.div
          layoutId="site-address"
          transition={{ duration: duration.xslow, ease: ease.emphasized }}
          className="focus-glow flex items-center gap-2 rounded-2xl border border-border bg-card p-2 pl-4 shadow-[0_18px_48px_-30px_hsl(var(--foreground)/0.45)]"
        >
          <span className="grid h-6 w-6 shrink-0 place-items-center" aria-hidden>
            {showIcon ? (
              <img
                src={faviconFor(previewHost, 64)}
                alt=""
                referrerPolicy="no-referrer"
                className="h-5 w-5 rounded-[5px]"
                onError={() => setBrokenIcon(previewHost)}
              />
            ) : (
              <Globe className="h-5 w-5 text-muted-foreground" />
            )}
          </span>
          <input
            autoFocus
            type="text"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="yourcompany.com"
            aria-label="Website URL"
            className="h-11 min-w-0 flex-1 bg-transparent! text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={!valid}
            aria-label="Scan my brand"
            className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-[13.5px] font-semibold text-primary-foreground transition hover:brightness-110 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40"
          >
            <span className="hidden sm:inline">Scan my brand</span>
            <span className="sm:hidden">Scan</span>
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </motion.div>
      </form>

      <div className="mt-10">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          What Mellox will learn
        </p>
        <motion.ul
          className="mt-3 flex flex-wrap gap-2"
          variants={list}
          initial="hidden"
          animate="show"
        >
          {LEARNS.map(({ icon: Icon, label }) => (
            <motion.li
              key={label}
              variants={reduce ? fadeItem : item}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1.5 text-[12.5px] text-foreground/80"
            >
              <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
              {label}
            </motion.li>
          ))}
        </motion.ul>
        <p className="mt-6 text-[12px] text-muted-foreground">
          Public pages only. You'll review everything before it's saved.
        </p>
      </div>
    </div>
  );
}

"use client";

import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { motion, type Variants } from "framer-motion";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Globe,
  Lightbulb,
  Megaphone,
  Palette,
  RefreshCw,
  Spinner,
  Swords,
  Target,
  ThumbsDown,
  ThumbsUp,
  Type,
  Users,
  type LucideIcon,
} from "@/components/icons";
import { countBrandDnaFilled } from "@/hooks/use-brand-dna";
import type { BrandExtractResult } from "@/lib/brand-extract-events";
import { normalizeHex, pickTextOn } from "@/lib/color";
import { duration, ease } from "@/lib/motion";
import { splitGuidance } from "./guidance";
import { BrandMark, Eyebrow, Tag } from "./ui";
import { hostOf } from "./url";

export const EDITABLE_FIELDS = [
  "brandName",
  "oneLiner",
  "industry",
  "businessModel",
  "audience",
  "voice",
  "products",
  "positioning",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
export type BrandEdits = Partial<Record<EditableField, string>>;

const MISSING = "Not found on your site — add it";

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};
const rise: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: duration.xslow, ease: ease.emphasized } },
};
const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.fast } },
};
const swatchGroup: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05, delayChildren: 0.2 } },
};
const swatchIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  show: { opacity: 1, scale: 1, transition: { duration: duration.slow, ease: ease.emphasized } },
};

export function BrandReveal({
  brand,
  url,
  saving,
  reduce,
  headingRef,
  onChange,
  onContinue,
  onRescan,
  onChangeUrl,
}: {
  brand: BrandExtractResult;
  url: string;
  saving: boolean;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onChange: (patch: BrandEdits) => void;
  onContinue: () => void;
  onRescan: () => void;
  onChangeUrl: () => void;
}) {
  const host = hostOf(url);
  const name = brand.brandName?.trim() || "";
  const { filled, total } = countBrandDnaFilled(brand);
  const card = reduce ? fade : rise;

  const colors = (brand.colors ?? [])
    .map((c) => ({ name: c.name || "Color", hex: normalizeHex(c.hex) }))
    .filter((c): c is { name: string; hex: string } => !!c.hex);
  const fonts = (brand.fonts ?? []).filter(Boolean).slice(0, 3);
  const doRules = splitGuidance(brand.doRules);
  const dontRules = splitGuidance(brand.dontRules);
  const valueTags = (brand.valueTags ?? []).filter(Boolean);
  const audienceTags = (brand.audienceTags ?? []).filter(Boolean);
  const keywords = (brand.keywords ?? []).filter(Boolean).slice(0, 14);
  const competitors = (brand.competitors ?? []).filter((c) => c?.name).slice(0, 5);
  const insights = (brand.insights ?? []).filter((i) => i?.title).slice(0, 4);
  const hasMarket = keywords.length > 0 || competitors.length > 0;
  const statements = (
    [
      ["Unique value", brand.uniqueValueProp],
      ["Mission", brand.mission],
      ["Vision", brand.vision],
    ] as const
  ).filter(([, value]) => value?.trim());
  const customerBits = (
    [
      ["Jobs to be done", brand.customerSignals?.jobsToBeDone],
      ["Pain points", brand.customerSignals?.painPoints],
    ] as const
  ).filter(([, value]) => value?.trim());

  const extras = brand.extras ?? {};
  const pages = extras.pagesCrawled?.length ?? 0;
  const mentions = extras.externalMentions?.length ?? 0;
  const socials = brand.socials?.length ?? 0;
  const provenance = [
    pages && `Built from ${pages} page${pages === 1 ? "" : "s"}`,
    mentions && `${mentions} web mention${mentions === 1 ? "" : "s"}`,
    socials && `${socials} social profile${socials === 1 ? "" : "s"}`,
  ].filter(Boolean);

  const field = (key: EditableField) => ({
    id: `dna-${key}`,
    value: brand[key] ?? "",
    onChange: (value: string) => onChange({ [key]: value }),
  });

  return (
    <div>
      <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Eyebrow icon={Check}>Scan complete · {host}</Eyebrow>
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="mt-3 text-[clamp(2rem,4.5vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
          >
            Review your Brand DNA.
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
            This is how Mellox now sees {name || "your brand"}. Everything is editable, and it
            shapes every draft, insight and recommendation.
          </p>
        </div>
        <div className="w-full shrink-0 sm:w-56">
          <div className="flex items-baseline justify-between text-[12px]">
            <span className="text-muted-foreground">Essentials found</span>
            <span className="font-medium tabular-nums">
              {filled} of {total}
            </span>
          </div>
          <div
            className="mt-2 flex gap-1"
            role="img"
            aria-label={`${filled} of ${total} essentials found`}
          >
            {Array.from({ length: total }, (_, index) => (
              <motion.span
                key={index}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${index < filled ? "bg-primary" : "bg-border"}`}
                initial={reduce ? false : { opacity: 0, scaleY: 0.3 }}
                animate={{ opacity: 1, scaleY: 1 }}
                transition={{ duration: duration.medium, delay: reduce ? 0 : 0.2 + index * 0.03 }}
              />
            ))}
          </div>
        </div>
      </header>

      <motion.div
        className="mt-8 grid gap-4 lg:grid-cols-12"
        variants={container}
        initial="hidden"
        animate="show"
      >
        {/* Identity */}
        <motion.section
          data-no-rhythm
          variants={card}
          aria-labelledby="dna-identity"
          className="relative overflow-hidden rounded-[22px] border border-border bg-card p-5 sm:p-7 lg:col-span-7"
        >
          {colors.length > 0 && (
            <div aria-hidden className="absolute inset-x-0 top-0 flex h-1">
              {colors.slice(0, 5).map((c) => (
                <span key={c.hex} className="flex-1" style={{ background: c.hex }} />
              ))}
            </div>
          )}
          <h2 id="dna-identity" className="sr-only">
            Identity
          </h2>
          <div className="flex items-start gap-4">
            <BrandMark sources={[brand.logoUrl, brand.faviconUrl]} name={name || host} size={64} />
            <div className="min-w-0 flex-1">
              <InlineField
                {...field("brandName")}
                label="Brand name"
                hideLabel
                size="display"
                placeholder="Your brand name"
              />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground transition hover:text-foreground"
              >
                <Globe className="h-3.5 w-3.5" aria-hidden /> {host}
              </a>
            </div>
          </div>
          <div className="mt-5">
            <InlineField {...field("oneLiner")} label="One-liner" hideLabel multiline size="lead" />
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <InlineField {...field("industry")} label="Industry" multiline />
            <InlineField {...field("businessModel")} label="Business model" multiline />
          </div>
          {brand.about?.trim() && (
            <p className="mt-5 border-t border-border pt-4 text-[13px] leading-relaxed text-muted-foreground">
              {brand.about}
            </p>
          )}
        </motion.section>

        <div className="grid content-start gap-4 lg:col-span-5">
          <Card
            variants={card}
            icon={Palette}
            title="Palette"
            meta={colors.length ? "Tap to copy" : undefined}
          >
            {colors.length ? (
              <motion.ul variants={swatchGroup} className="grid grid-cols-3 gap-2">
                {colors.map((color, index) => (
                  <Swatch key={`${color.hex}-${index}`} color={color} reduce={reduce} />
                ))}
              </motion.ul>
            ) : (
              <Empty>No brand colors were detected. You can add them later in Brand DNA.</Empty>
            )}
          </Card>

          <Card variants={card} icon={Type} title="Typography">
            {fonts.length ? (
              <ul className="space-y-3">
                {fonts.map((font, index) => (
                  <li key={font} className="flex items-baseline gap-4">
                    <span
                      aria-hidden
                      className="w-12 text-[30px] leading-none"
                      style={{ fontFamily: `"${font.replace(/["\\]/g, "")}", var(--font-sans)` }}
                    >
                      Aa
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[14px] font-medium">{font}</span>
                      <span className="block text-[11.5px] text-muted-foreground">
                        {index === 0 ? "Primary typeface" : "Supporting typeface"}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty>No custom typeface was declared on your site.</Empty>
            )}
          </Card>
        </div>

        {/* Voice */}
        <Card
          variants={card}
          icon={Megaphone}
          title="Voice"
          meta={brand.sources?.voice?.label}
          className="lg:col-span-7"
        >
          <InlineField {...field("voice")} label="How you sound" hideLabel multiline size="quote" />
          {valueTags.length > 0 && <TagList label="Values" tags={valueTags} />}
          {(doRules.length > 0 || dontRules.length > 0) && (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <Guidance tone="do" items={doRules} />
              <Guidance tone="dont" items={dontRules} />
            </div>
          )}
        </Card>

        {/* Audience */}
        <Card
          variants={card}
          icon={Users}
          title="Audience"
          meta={brand.sources?.audience?.label}
          className="lg:col-span-5"
        >
          <InlineField {...field("audience")} label="Who you serve" hideLabel multiline />
          {audienceTags.length > 0 && <TagList label="Segments" tags={audienceTags} />}
          {customerBits.length > 0 && (
            <dl className="mt-5 space-y-3 border-t border-border pt-4">
              {customerBits.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-foreground/85">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>

        {/* Positioning */}
        <Card
          variants={card}
          icon={Target}
          title="Positioning"
          className={hasMarket ? "lg:col-span-7" : "lg:col-span-12"}
        >
          <InlineField
            {...field("positioning")}
            label="Positioning"
            hideLabel
            multiline
            size="lead"
          />
          {statements.length > 0 && (
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              {statements.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    {label}
                  </dt>
                  <dd className="mt-1 text-[13px] leading-relaxed text-foreground/85">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          <div className="mt-5">
            <InlineField {...field("products")} label="Products & services" multiline />
          </div>
        </Card>

        {hasMarket && (
          <Card variants={card} icon={Swords} title="Market" className="lg:col-span-5">
            {keywords.length > 0 && <TagList label="Keywords" tags={keywords} first />}
            {competitors.length > 0 && (
              <div className={keywords.length ? "mt-5" : ""}>
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Competitors
                </p>
                <ul className="mt-2 divide-y divide-border">
                  {competitors.map((competitor) => (
                    <li key={competitor.name} className="py-2.5 first:pt-1 last:pb-0">
                      <p className="text-[13.5px] font-medium">{competitor.name}</p>
                      {competitor.positioning && (
                        <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                          {competitor.positioning}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Card>
        )}

        {insights.length > 0 && (
          <Card
            variants={card}
            icon={Lightbulb}
            title="What Mellox learned"
            className="lg:col-span-12"
          >
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {insights.map((insight) => (
                <li key={insight.title} className="rounded-xl bg-surface-2 p-4">
                  <p className="text-[13px] font-semibold leading-snug">{insight.title}</p>
                  {insight.body && (
                    <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                      {insight.body}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </motion.div>

      {provenance.length > 0 && (
        <p className="mt-6 text-center text-[12px] text-muted-foreground">
          {provenance.join(" · ")}
        </p>
      )}

      <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background/90 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-md sm:static sm:mx-0 sm:mt-8 sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-none">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onChangeUrl}
              disabled={saving}
              aria-label="Change URL"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Change URL</span>
            </button>
            <button
              type="button"
              onClick={onRescan}
              disabled={saving}
              aria-label="Scan again"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">Scan again</span>
            </button>
          </div>
          <button
            type="button"
            onClick={onContinue}
            disabled={saving}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground shadow-[0_12px_28px_-14px_hsl(var(--primary)/0.8)] transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60"
          >
            {saving ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" aria-hidden /> Saving Brand DNA…
              </>
            ) : (
              <>
                Enter Mellox <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function Card({
  variants,
  icon: Icon,
  title,
  meta,
  className = "",
  children,
}: {
  variants: Variants;
  icon: LucideIcon;
  title: string;
  meta?: string;
  className?: string;
  children: ReactNode;
}) {
  const id = `dna-${title.toLowerCase().replace(/[^a-z]+/g, "-")}`;
  return (
    <motion.section
      data-no-rhythm
      variants={variants}
      aria-labelledby={id}
      className={`rounded-[22px] border border-border bg-card p-5 sm:p-6 ${className}`}
    >
      <header className="mb-4 flex items-center justify-between gap-3">
        <h2 id={id} className="inline-flex items-center gap-2 text-[13px] font-semibold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary-surface text-primary">
            <Icon className="h-3.5 w-3.5" aria-hidden />
          </span>
          {title}
        </h2>
        {meta && <span className="truncate text-[11.5px] text-muted-foreground">{meta}</span>}
      </header>
      {children}
    </motion.section>
  );
}

const FIELD_SIZES = {
  display: "text-[clamp(1.6rem,3.6vw,2.25rem)] font-semibold leading-tight tracking-[-0.03em]",
  quote: "text-[17px] font-medium leading-snug tracking-[-0.01em]",
  lead: "text-[15px] leading-relaxed text-foreground/90",
  base: "text-[14px] leading-relaxed",
} as const;

/**
 * Reads as content, edits in place. The border only appears on hover/focus —
 * or dashed, when the scan found nothing, to invite the user to fill it.
 */
function InlineField({
  id,
  label,
  value,
  onChange,
  placeholder = MISSING,
  multiline = false,
  hideLabel = false,
  size = "base",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hideLabel?: boolean;
  size?: keyof typeof FIELD_SIZES;
}) {
  const missing = !value.trim();
  const className = `-mx-2.5 block w-[calc(100%+1.25rem)] rounded-lg border mt-0 bg-transparent! px-2.5 py-1.5 outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground/70 hover:border-border! focus:border-primary! focus:bg-surface-2/60! focus-visible:ring-2 focus-visible:ring-primary-border ${missing ? "border-dashed border-border-strong" : "border-transparent!"} ${FIELD_SIZES[size]}`;
  return (
    <div>
      <label
        htmlFor={id}
        className={
          hideLabel
            ? "sr-only"
            : "mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
        }
      >
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={`resize-none ${className}`}
          style={{ fieldSizing: "content", minHeight: "2.25rem" } as CSSProperties}
        />
      ) : (
        <input
          id={id}
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className={className}
        />
      )}
    </div>
  );
}

function Swatch({ color, reduce }: { color: { name: string; hex: string }; reduce: boolean }) {
  const [copied, setCopied] = useState(false);
  const hex = color.hex.toUpperCase();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopied(true);
      toast.success(`Copied ${hex}`);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy that color");
    }
  };
  return (
    <motion.li variants={swatchIn}>
      <motion.button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copy ${color.name} ${hex}`}
        whileHover={reduce ? undefined : { y: -2 }}
        whileTap={reduce ? undefined : { scale: 0.97 }}
        className="group relative flex h-20 w-full flex-col justify-end rounded-xl border border-black/5 p-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
        style={{ background: color.hex, color: pickTextOn(color.hex) }}
      >
        <span className="truncate text-[11.5px] font-semibold leading-tight">{color.name}</span>
        <span className="font-mono text-[10.5px] opacity-75">{hex}</span>
        <span
          aria-hidden
          className={`absolute right-2 top-2 transition-opacity ${copied ? "opacity-100" : "opacity-0 group-hover:opacity-80 group-focus-visible:opacity-80"}`}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </span>
      </motion.button>
    </motion.li>
  );
}

function Guidance({ tone, items }: { tone: "do" | "dont"; items: string[] }) {
  const isDo = tone === "do";
  return (
    <div className="rounded-xl border border-border bg-surface-2/60 p-4">
      <p className="flex items-center gap-2 text-[12px] font-semibold">
        {isDo ? (
          <ThumbsUp className="h-3.5 w-3.5 text-primary" aria-hidden />
        ) : (
          <ThumbsDown className="h-3.5 w-3.5 text-danger" aria-hidden />
        )}
        {isDo ? "Do" : "Don't"}
      </p>
      {items.length ? (
        <ul className="mt-2.5 space-y-2">
          {items.map((item) => (
            <li key={item} className="flex gap-2 text-[13px] leading-snug text-foreground/85">
              <span
                aria-hidden
                className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${isDo ? "bg-primary" : "bg-danger"}`}
              />
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2.5 text-[12.5px] text-muted-foreground">No guidance found.</p>
      )}
    </div>
  );
}

function TagList({
  label,
  tags,
  first = false,
}: {
  label: string;
  tags: string[];
  first?: boolean;
}) {
  return (
    <div className={first ? "" : "mt-4"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {tags.map((tag) => (
          <Tag key={tag}>{tag}</Tag>
        ))}
      </ul>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-border-strong px-4 py-5 text-center text-[12.5px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

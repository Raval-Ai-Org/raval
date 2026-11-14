"use client";

import { useRef, useState, type ReactNode, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Baby,
  Briefcase,
  Car,
  Check,
  Coffee,
  Dumbbell,
  Gem,
  Globe,
  GraduationCap,
  Heart,
  ImagePlus,
  Laptop,
  Link,
  Paintbrush,
  PawPrint,
  PenLine,
  Pipette,
  Plane,
  Plus,
  RefreshCw,
  Shirt,
  ShoppingBag,
  Sofa,
  Sparkles,
  Spinner,
  Stethoscope,
  Store,
  Swords,
  Upload,
  Users,
  UtensilsCrossed,
  Wrench,
  X,
  type LucideIcon,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import { MoxSpeech } from "@/components/app/surface/MoxParts";
import {
  CATEGORIES,
  LIMITS,
  MANUAL_PARTS,
  PALETTES,
  PART_LABELS,
  VOICES,
  addColor,
  addCompetitor,
  basicsIssue,
  categoryFor,
  colorRole,
  filledParts,
  inkOn,
  kitScore,
  makePrimary,
  normalizeHex,
  removeColor,
  type CategoryId,
  type ManualBrand,
  type ManualPart,
  type Sells,
} from "@/lib/onboarding/manual-brand";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { LOGO_TYPES, processLogo } from "./manual/logo";
import { MAX_INSPIRATIONS, type InspoItem } from "./manual/use-manual-inspiration";

export { emptyManualBrand, type ManualBrand } from "@/lib/onboarding/manual-brand";

const SELLS: { id: Sells; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "products", label: "Products", hint: "Things people buy", icon: ShoppingBag },
  { id: "services", label: "Services", hint: "Work you do for people", icon: Wrench },
  { id: "both", label: "Both", hint: "A bit of each", icon: PenLine },
];

const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  food: UtensilsCrossed,
  fashion: Shirt,
  beauty: Sparkles,
  fitness: Dumbbell,
  health: Stethoscope,
  home: Sofa,
  tech: Laptop,
  education: GraduationCap,
  creative: Paintbrush,
  services: Briefcase,
  local: Store,
  travel: Plane,
  pets: PawPrint,
  kids: Baby,
  jewellery: Gem,
  auto: Car,
};

const MOX_LINES: Record<ManualPart, ReactNode> = {
  basics: (
    <>
      No website? <b>No problem.</b> Let&rsquo;s build your brand together.
    </>
  ),
  category: (
    <>
      What kind of brand are you, and <b>who is it for?</b>
    </>
  ),
  look: (
    <>
      Show me your <b>look</b>: logo, colours and how you sound.
    </>
  ),
  inspiration: (
    <>
      Add posts or pictures you <b>love.</b> I&rsquo;ll design in that direction.
    </>
  ),
  competitors: (
    <>
      Who else do your customers <b>look at?</b>
    </>
  ),
};

const HEADINGS: Record<ManualPart, string> = {
  basics: "Tell Mellox about your brand",
  category: "Your category and customers",
  look: "Your logo, colours and tone",
  inspiration: "Pictures and posts you love",
  competitors: "Brands you compete with",
};

const field =
  "w-full rounded-[var(--ds-radius-well)] border border-border/70 bg-[var(--ds-well-bg)] px-4 text-[15px] outline-none transition placeholder:text-muted-foreground/70 focus:border-primary/50 focus:bg-card focus:ring-2 focus:ring-primary/20";

export type ManualBrandStepProps = {
  value: ManualBrand;
  part: ManualPart;
  inspirations: InspoItem[];
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onChange: (patch: Partial<ManualBrand>) => void;
  onPart: (part: ManualPart) => void;
  onAddInspoFiles: (files: File[]) => string | null;
  onAddInspoLink: (url: string) => string | null;
  onRemoveInspo: (key: string) => void;
  onRetryInspo: (key: string) => void;
  /** Back to the website question. */
  onHaveWebsite: () => void;
  onDone: () => void;
};

/**
 * No website (Holo style): five short parts, one at a time, with Mox asking
 * and a live card of the brand filling in beside them. Only the basics are
 * needed; every other part can be skipped and filled later in Brain or Inspo.
 * Presentational: OnboardingPage and /onboarding-lab wire it.
 */
export function ManualBrandStep(p: ManualBrandStepProps) {
  const index = MANUAL_PARTS.indexOf(p.part);
  const last = index === MANUAL_PARTS.length - 1;
  const issue = p.part === "basics" ? basicsIssue(p.value) : null;
  const saved = p.inspirations.filter((i) => i.status === "done").length;
  const filled = filledParts(p.value, saved);
  const uploading =
    p.part === "inspiration" && p.inspirations.some((i) => i.status === "uploading");
  const [direction, setDirection] = useState(1);

  const goTo = (part: ManualPart) => {
    setDirection(MANUAL_PARTS.indexOf(part) >= index ? 1 : -1);
    p.onPart(part);
  };
  const next = () => {
    if (issue) return;
    if (last) p.onDone();
    else goTo(MANUAL_PARTS[index + 1]);
  };
  const back = () => (index === 0 ? p.onHaveWebsite() : goTo(MANUAL_PARTS[index - 1]));

  const slide = {
    initial: p.reduce ? { opacity: 0 } : { opacity: 0, x: 24 * direction },
    animate: { opacity: 1, x: 0, transition: { duration: duration.medium, ease: ease.emphasized } },
    exit: p.reduce
      ? { opacity: 0 }
      : {
          opacity: 0,
          x: -24 * direction,
          transition: { duration: duration.fast, ease: ease.accelerate },
        },
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-10">
      <div className="min-w-0">
        <MoxSpeech pose="face" size={84}>
          {MOX_LINES[p.part]}
        </MoxSpeech>

        <PartTabs
          current={p.part}
          filled={filled}
          locked={basicsIssue(p.value) !== null}
          onPick={goTo}
        />

        <form
          noValidate
          className="mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={p.part} {...slide}>
              <h1
                ref={p.headingRef}
                tabIndex={-1}
                className="text-[clamp(1.5rem,3.4vw,2rem)] font-semibold leading-[1.1] tracking-[-0.03em] outline-none"
              >
                {HEADINGS[p.part]}
              </h1>
              <div className="mt-5">
                {p.part === "basics" && <BasicsPart value={p.value} onChange={p.onChange} />}
                {p.part === "category" && <CategoryPart value={p.value} onChange={p.onChange} />}
                {p.part === "look" && <LookPart value={p.value} onChange={p.onChange} />}
                {p.part === "inspiration" && (
                  <InspirationPart
                    items={p.inspirations}
                    onFiles={p.onAddInspoFiles}
                    onLink={p.onAddInspoLink}
                    onRemove={p.onRemoveInspo}
                    onRetry={p.onRetryInspo}
                  />
                )}
                {p.part === "competitors" && (
                  <CompetitorsPart value={p.value} onChange={p.onChange} />
                )}
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Pinned to the bottom of the stage, so Continue is always on screen. */}
          <div className="ob-glass sticky bottom-0 z-10 mt-8 flex flex-wrap items-center justify-between gap-2 rounded-[26px] p-1.5">
            <button
              type="button"
              onClick={back}
              className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
            >
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {index === 0 ? "I have a website" : "Back"}
            </button>
            <div className="flex items-center gap-2">
              {p.part !== "basics" && !filled[p.part] && (
                <button
                  type="button"
                  onClick={next}
                  className="h-11 rounded-full px-4 text-[13.5px] font-medium text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  Skip for now
                </button>
              )}
              <button
                type="submit"
                disabled={Boolean(issue) || uploading}
                title={issue ?? (uploading ? "Still uploading…" : undefined)}
                className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
              >
                {uploading ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" aria-hidden /> Uploading
                  </>
                ) : (
                  <>
                    {last ? "Looks good" : "Continue"}{" "}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </>
                )}
              </button>
            </div>
          </div>
          {issue && p.value.brandName.trim().length > 0 && (
            <p className="mt-3 text-right text-[12.5px] text-muted-foreground" aria-live="polite">
              {issue}
            </p>
          )}
        </form>
      </div>

      <aside aria-label="Your brand so far" className="lg:sticky lg:top-6 lg:self-start">
        <BrandPreview value={p.value} inspirations={p.inspirations} reduce={p.reduce} />
      </aside>
    </div>
  );
}

/* ───────────── part tabs ───────────── */

function PartTabs({
  current,
  filled,
  locked,
  onPick,
}: {
  current: ManualPart;
  filled: Record<ManualPart, boolean>;
  locked: boolean;
  onPick: (part: ManualPart) => void;
}) {
  return (
    <nav aria-label="Brand setup parts" className="mt-6 -mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-1.5">
        {MANUAL_PARTS.map((part, i) => {
          const active = part === current;
          const disabled = locked && part !== "basics";
          return (
            <li key={part}>
              <button
                type="button"
                disabled={disabled}
                aria-current={active ? "step" : undefined}
                onClick={() => onPick(part)}
                className={cn(
                  "relative inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition-colors disabled:opacity-40",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="manual-part-pill"
                    className="absolute inset-0 rounded-full border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]"
                    transition={{ type: "spring", stiffness: 420, damping: 34 }}
                  />
                )}
                <span
                  className={cn(
                    "relative grid h-4 w-4 place-items-center rounded-full text-[10px] font-semibold",
                    filled[part] ? "bg-primary text-primary-foreground" : "bg-[var(--ds-well-bg)]",
                  )}
                >
                  {filled[part] ? <Check className="h-2.5 w-2.5" aria-hidden /> : i + 1}
                </span>
                <span className="relative">{PART_LABELS[part]}</span>
                {filled[part] && <span className="sr-only">(filled)</span>}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ───────────── basics ───────────── */

function Counter({ value, max }: { value: string; max: number }) {
  const near = value.length > max * 0.85;
  return (
    <span
      className={cn(
        "text-[11px] tabular-nums",
        near ? "text-foreground/70" : "text-muted-foreground/70",
      )}
    >
      {value.length}/{max}
    </span>
  );
}

function Label({
  children,
  optional,
  aside,
}: {
  children: ReactNode;
  optional?: boolean;
  aside?: ReactNode;
}) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] font-medium">
      <span>
        {children}
        {optional && <span className="ml-1 font-normal text-muted-foreground">(optional)</span>}
      </span>
      {aside}
    </span>
  );
}

function BasicsPart({
  value,
  onChange,
}: {
  value: ManualBrand;
  onChange: (p: Partial<ManualBrand>) => void;
}) {
  return (
    <div className="space-y-5">
      <label className="block">
        <Label>Brand name</Label>
        <input
          autoFocus
          value={value.brandName}
          maxLength={LIMITS.brandName}
          onChange={(e) => onChange({ brandName: e.target.value })}
          placeholder="e.g. Northwind Coffee"
          className={cn(field, "h-12")}
        />
      </label>
      <label className="block">
        <Label aside={<Counter value={value.oneLiner} max={LIMITS.oneLiner} />}>
          What you do, in one line
        </Label>
        <input
          value={value.oneLiner}
          maxLength={LIMITS.oneLiner}
          onChange={(e) => onChange({ oneLiner: e.target.value })}
          placeholder="e.g. Small-batch coffee roasted in Leeds, delivered weekly"
          className={cn(field, "h-12")}
        />
      </label>
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">What do you sell?</legend>
        <div role="radiogroup" className="grid grid-cols-3 gap-2">
          {SELLS.map(({ id, label, hint, icon: Icon }) => {
            const on = value.sells === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onChange({ sells: id })}
                className={cn(
                  "ds-tile flex flex-col items-start gap-2 p-3 text-left transition-[border-color,background-color,box-shadow] duration-200 sm:p-3.5",
                  on
                    ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_0_3px_hsl(var(--primary)/0.14)]"
                    : "ds-tile-hover",
                )}
              >
                <span
                  className={cn(
                    "grid h-8 w-8 place-items-center rounded-full transition-colors",
                    on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary-ink",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span>
                  <span className="block text-[14px] font-semibold leading-tight">{label}</span>
                  <span className="mt-0.5 hidden text-[12px] leading-snug text-muted-foreground sm:block">
                    {hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

/* ───────────── category ───────────── */

function CategoryPart({
  value,
  onChange,
}: {
  value: ManualBrand;
  onChange: (p: Partial<ManualBrand>) => void;
}) {
  const preset = categoryFor(value.industry);
  const [custom, setCustom] = useState(Boolean(value.industry && !preset));
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Category</legend>
        <div role="radiogroup" className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {CATEGORIES.map((c) => {
            const Icon = CATEGORY_ICONS[c.id];
            const on = !custom && preset?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setCustom(false);
                  onChange({ industry: on ? "" : c.label });
                }}
                className={cn(
                  "ds-tile flex h-11 items-center gap-2 px-3 text-left text-[12.5px] font-medium transition-[border-color,background-color] duration-200",
                  on ? "border-primary/60 bg-primary/[0.07]" : "ds-tile-hover text-foreground/80",
                )}
              >
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    on ? "text-primary-ink" : "text-muted-foreground",
                  )}
                  aria-hidden
                />
                <span className="truncate">{c.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={custom}
            onClick={() => {
              setCustom(true);
              if (preset) onChange({ industry: "" });
            }}
            className={cn(
              "ds-tile flex h-11 items-center gap-2 px-3 text-[12.5px] font-medium transition-colors",
              custom ? "border-primary/60 bg-primary/[0.07]" : "ds-tile-hover text-foreground/80",
            )}
          >
            <Plus className="h-4 w-4 text-muted-foreground" aria-hidden /> Something else
          </button>
        </div>
        <AnimatePresence initial={false}>
          {custom && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <input
                autoFocus
                aria-label="Your category"
                value={value.industry}
                maxLength={LIMITS.industry}
                onChange={(e) => onChange({ industry: e.target.value })}
                placeholder="e.g. Handmade ceramics"
                className={cn(field, "mt-2 h-11")}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </fieldset>

      <label className="block">
        <Label optional>Who is it for?</Label>
        <textarea
          rows={2}
          value={value.audience}
          maxLength={LIMITS.audience}
          onChange={(e) => onChange({ audience: e.target.value })}
          placeholder="e.g. Busy professionals in their 30s who care where their coffee comes from"
          className={cn(field, "resize-none py-3 leading-relaxed")}
        />
      </label>

      <label className="block">
        <Label
          optional
          aside={value.about ? <Counter value={value.about} max={LIMITS.about} /> : null}
        >
          Your story
        </Label>
        <textarea
          rows={4}
          value={value.about}
          maxLength={LIMITS.about}
          onChange={(e) => onChange({ about: e.target.value })}
          placeholder="How you started, what makes you different, what you care about…"
          className={cn(field, "resize-none py-3 leading-relaxed")}
        />
      </label>
    </div>
  );
}

/* ───────────── look ───────────── */

function LookPart({
  value,
  onChange,
}: {
  value: ManualBrand;
  onChange: (p: Partial<ManualBrand>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromLogo, setFromLogo] = useState<string[]>([]);
  const [hex, setHex] = useState("");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLInputElement>(null);
  const full = value.colors.length >= LIMITS.colors;

  const takeLogo = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const logo = await processLogo(file);
      setFromLogo(logo.palette);
      // An empty palette is filled from the logo; one the person made is kept.
      onChange(
        value.colors.length
          ? { logo: logo.dataUrl }
          : { logo: logo.dataUrl, colors: logo.palette.slice(0, 3) },
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This logo can't be read.");
    } finally {
      setBusy(false);
    }
  };

  const addHex = () => {
    const normal = normalizeHex(hex);
    if (!normal) return;
    onChange({ colors: addColor(value.colors, normal) });
    setHex("");
  };
  const suggestions = fromLogo.filter((c) => !value.colors.includes(c));

  return (
    <div className="space-y-7">
      {/* Logo */}
      <section aria-labelledby="look-logo">
        <p id="look-logo" className="mb-2 text-[13px] font-medium">
          Logo <span className="font-normal text-muted-foreground">(optional)</span>
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void takeLogo(e.dataTransfer.files[0]);
          }}
          className={cn(
            "ds-tile flex items-center gap-4 border-dashed p-4 transition-colors",
            dragging && "border-primary/60 bg-primary/[0.06]",
          )}
        >
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[repeating-conic-gradient(hsl(var(--foreground)/0.05)_0%_25%,transparent_0%_50%)] bg-[length:14px_14px]">
            {busy ? (
              <Spinner className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
            ) : value.logo ? (
              <img src={value.logo} alt="Your logo" className="max-h-16 max-w-16 object-contain" />
            ) : (
              <ImagePlus className="h-6 w-6 text-muted-foreground" aria-hidden />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-medium">
              {value.logo ? "Looking sharp." : "Drop your logo here"}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              PNG with a clear background works best. Mellox places it on your posts.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden />{" "}
                {value.logo ? "Replace" : "Upload logo"}
              </button>
              {value.logo && (
                <button
                  type="button"
                  onClick={() => onChange({ logo: null })}
                  className="h-8 rounded-full px-3 text-[12.5px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept={LOGO_TYPES.join(",")}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => {
              void takeLogo(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {error && (
          <p role="alert" className="mt-2 flex items-center gap-1.5 text-[12.5px] text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {error}
          </p>
        )}
      </section>

      {/* Colours */}
      <section aria-labelledby="look-colors">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p id="look-colors" className="text-[13px] font-medium">
            Brand colours <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          {value.colors.length > 1 && (
            <span className="text-[11.5px] text-muted-foreground">
              Tap a colour to make it primary
            </span>
          )}
        </div>

        <ul className="flex flex-wrap items-center gap-2.5">
          <AnimatePresence initial={false}>
            {value.colors.map((c, i) => (
              <motion.li
                key={c}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 420, damping: 28 }}
                className="group relative"
              >
                <button
                  type="button"
                  onClick={() => onChange({ colors: makePrimary(value.colors, c) })}
                  aria-label={`${colorRole(i)} ${c}${i ? ", make primary" : ""}`}
                  className={cn(
                    "flex h-16 w-16 flex-col items-start justify-end rounded-2xl p-1.5 text-left shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.08)] transition-transform hover:-translate-y-0.5",
                    i === 0 && "h-16 w-24",
                  )}
                  style={{ background: c, color: inkOn(c) }}
                >
                  <span className="text-[9.5px] font-semibold uppercase leading-none opacity-80">
                    {colorRole(i)}
                  </span>
                  <span className="mt-0.5 font-mono text-[10px] leading-none opacity-90">{c}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChange({ colors: removeColor(value.colors, c) })}
                  aria-label={`Remove ${c}`}
                  className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
          {!full && (
            <li className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => colorRef.current?.click()}
                aria-label="Pick a colour"
                className="grid h-16 w-16 place-items-center rounded-2xl border border-dashed border-border-strong text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                <Pipette className="h-5 w-5" aria-hidden />
              </button>
              <input
                ref={colorRef}
                type="color"
                className="sr-only"
                tabIndex={-1}
                aria-hidden
                onChange={(e) => onChange({ colors: addColor(value.colors, e.target.value) })}
              />
              <div className="flex items-center gap-1 rounded-full border border-border/70 bg-[var(--ds-well-bg)] py-1 pl-3 pr-1">
                <span className="text-[13px] text-muted-foreground">#</span>
                <input
                  aria-label="Hex colour"
                  value={hex.replace(/^#/, "")}
                  maxLength={6}
                  onChange={(e) => setHex(e.target.value.replace(/[^0-9a-f]/gi, ""))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addHex();
                    }
                  }}
                  placeholder="1F3B2D"
                  className="w-[68px] bg-transparent font-mono text-[13px] uppercase outline-none placeholder:normal-case placeholder:text-muted-foreground/60"
                />
                <button
                  type="button"
                  onClick={addHex}
                  disabled={!normalizeHex(hex)}
                  aria-label="Add colour"
                  className="grid h-7 w-7 place-items-center rounded-full bg-foreground text-background transition disabled:opacity-30"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </li>
          )}
        </ul>

        {suggestions.length > 0 && !full && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
            <span className="mr-1">From your logo:</span>
            {suggestions.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onChange({ colors: addColor(value.colors, c) })}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border/70 bg-card pl-1 pr-2.5 font-mono text-[11px] text-foreground/80 transition hover:border-foreground/25"
              >
                <span
                  className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_hsl(var(--foreground)/0.1)]"
                  style={{ background: c }}
                />
                {c}
              </button>
            ))}
          </div>
        )}

        <div className="mt-4">
          <p className="mb-2 text-[12px] text-muted-foreground">
            {value.colors.length
              ? "Or swap for a ready-made palette"
              : "No colours yet? Start from a palette"}
          </p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {PALETTES.map((palette) => {
              const on = palette.colors.every((c, i) => value.colors[i] === c);
              return (
                <button
                  key={palette.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onChange({ colors: [...palette.colors] })}
                  className={cn(
                    "ds-tile flex items-center gap-2 p-2 text-left text-[12px] font-medium transition-colors",
                    on ? "border-primary/60 bg-primary/[0.07]" : "ds-tile-hover",
                  )}
                >
                  <span className="flex -space-x-1.5">
                    {palette.colors.map((c) => (
                      <span
                        key={c}
                        className="h-5 w-5 rounded-full border-2 border-card"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  {palette.label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Tone */}
      <section aria-labelledby="look-voice">
        <p id="look-voice" className="mb-2 text-[13px] font-medium">
          How you sound{" "}
          <span className="font-normal text-muted-foreground">(pick up to {LIMITS.voice})</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {VOICES.map((v) => {
            const on = value.voice.includes(v.id);
            const blocked = !on && value.voice.length >= LIMITS.voice;
            return (
              <button
                key={v.id}
                type="button"
                aria-pressed={on}
                disabled={blocked}
                title={v.line}
                onClick={() =>
                  onChange({
                    voice: on ? value.voice.filter((x) => x !== v.id) : [...value.voice, v.id],
                  })
                }
                className={cn(
                  "inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition-all disabled:opacity-40",
                  on
                    ? "border-transparent bg-primary text-primary-foreground"
                    : "border-border/70 bg-card text-foreground/80 hover:border-foreground/25",
                )}
              >
                {on && <Check className="h-3.5 w-3.5" aria-hidden />}
                {v.label}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

/* ───────────── inspiration ───────────── */

function InspirationPart({
  items,
  onFiles,
  onLink,
  onRemove,
  onRetry,
}: {
  items: InspoItem[];
  onFiles: (files: File[]) => string | null;
  onLink: (url: string) => string | null;
  onRemove: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const [link, setLink] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = items.length >= MAX_INSPIRATIONS;

  const take = (files: FileList | null) => {
    if (!files?.length) return;
    setNote(onFiles([...files]));
  };
  const addLink = () => {
    if (!link.trim()) return;
    const problem = onLink(link);
    setNote(problem);
    if (!problem) setLink("");
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        disabled={full}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files);
        }}
        className={cn(
          "ds-tile flex w-full flex-col items-center justify-center gap-2 border-dashed px-4 py-8 text-center transition-colors disabled:opacity-50",
          dragging ? "border-primary/60 bg-primary/[0.06]" : "ds-tile-hover",
        )}
      >
        <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary-ink">
          <Heart className="h-5 w-5" aria-hidden />
        </span>
        <span className="text-[14px] font-semibold">Drop pictures you love</span>
        <span className="text-[12.5px] text-muted-foreground">
          Posts, ads, photos, moodboards. Up to {MAX_INSPIRATIONS}, PNG, JPEG or WebP.
        </span>
      </button>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          take(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Link
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            aria-label="Link to a post or picture"
            value={link}
            disabled={full}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="Or paste a link to a post or picture"
            className={cn(field, "h-11 pl-10")}
          />
        </div>
        <button
          type="button"
          onClick={addLink}
          disabled={!link.trim() || full}
          className={cn(dsGhostBtn, "h-11 px-4 text-[13px]")}
        >
          Add
        </button>
      </div>
      {note && (
        <p role="status" className="text-[12.5px] text-muted-foreground">
          {note}
        </p>
      )}

      {items.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.key}
                layout
                initial={{ opacity: 0, scale: 0.85 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{ type: "spring", stiffness: 380, damping: 28 }}
                className="group relative aspect-square overflow-hidden rounded-2xl bg-[var(--ds-well-bg)]"
              >
                {item.preview ? (
                  <img src={item.preview} alt={item.label} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-center">
                    <Globe className="h-5 w-5 text-muted-foreground" aria-hidden />
                    <span className="line-clamp-2 break-all text-[11px] text-muted-foreground">
                      {item.label}
                    </span>
                  </div>
                )}
                {item.status === "uploading" && (
                  <div className="absolute inset-0 grid place-items-center bg-background/55 backdrop-blur-[2px]">
                    <Spinner className="h-5 w-5 animate-spin" aria-label="Uploading" />
                  </div>
                )}
                {item.status === "error" && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-card p-2 text-center">
                    <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden />
                    <span className="line-clamp-3 text-[10.5px] leading-tight text-destructive">
                      {item.error}
                    </span>
                    {item.link && (
                      <button
                        type="button"
                        onClick={() => onRetry(item.key)}
                        className="inline-flex h-6 items-center gap-1 rounded-full border border-border bg-card px-2 text-[11px] font-medium"
                      >
                        <RefreshCw className="h-3 w-3" aria-hidden /> Retry
                      </button>
                    )}
                  </div>
                )}
                {item.status === "done" && (
                  <span className="absolute bottom-1.5 left-1.5 grid h-5 w-5 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" aria-hidden />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onRemove(item.key)}
                  aria-label={`Remove ${item.label}`}
                  className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-background/90 text-foreground/80 opacity-0 shadow-sm transition group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <p className="text-[12px] text-muted-foreground">
        They go to your Inspo board, where you can add more any time.
      </p>
    </div>
  );
}

/* ───────────── competitors ───────────── */

function CompetitorsPart({
  value,
  onChange,
}: {
  value: ManualBrand;
  onChange: (p: Partial<ManualBrand>) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const full = value.competitors.length >= LIMITS.competitors;

  const add = () => {
    const result = addCompetitor(value.competitors, { name, url });
    setError(result.error);
    if (result.error) return;
    onChange({ competitors: result.list });
    setName("");
    setUrl("");
    nameRef.current?.focus();
  };

  return (
    <div className="space-y-4">
      <div className="ds-tile space-y-2.5 p-3 sm:p-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input
            ref={nameRef}
            aria-label="Competitor name"
            value={name}
            disabled={full}
            maxLength={LIMITS.competitorName}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Name, e.g. Bean Bros"
            className={cn(field, "h-11")}
          />
          <input
            aria-label="Competitor website (optional)"
            value={url}
            disabled={full}
            maxLength={LIMITS.competitorUrl}
            onChange={(e) => {
              setUrl(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="Website (optional)"
            className={cn(field, "h-11")}
          />
          <button
            type="button"
            onClick={add}
            disabled={full || (!name.trim() && !url.trim())}
            className={cn(dsGhostBtn, "h-11 px-4 text-[13px]")}
          >
            <Plus className="h-4 w-4" aria-hidden /> Add
          </button>
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] text-destructive">
            {error}
          </p>
        )}
      </div>

      {value.competitors.length > 0 ? (
        <ul className="space-y-1.5">
          <AnimatePresence initial={false}>
            {value.competitors.map((c) => (
              <motion.li
                key={c.name}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
                className="ds-tile flex items-center gap-3 px-3 py-2.5"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[var(--ds-well-bg)] text-[14px] font-semibold uppercase text-foreground/70">
                  {c.name.slice(0, 1)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{c.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">
                    {c.url ? c.url.replace(/^https?:\/\//, "") : "Mellox will look up their site"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ competitors: value.competitors.filter((x) => x !== c) })
                  }
                  aria-label={`Remove ${c.name}`}
                  className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--ds-well-bg)] px-4 py-3.5 text-[12.5px] text-muted-foreground">
          <Swords className="h-4 w-4 shrink-0" aria-hidden />
          Not sure yet? Skip it. Mellox can suggest some once you&rsquo;re in.
        </div>
      )}
      <p className="text-[12px] text-muted-foreground">
        They show up in Brain → Competitors, so posts stand apart from theirs.
      </p>
    </div>
  );
}

/* ───────────── live preview ───────────── */

function BrandPreview({
  value,
  inspirations,
  reduce,
}: {
  value: ManualBrand;
  inspirations: InspoItem[];
  reduce: boolean;
}) {
  const saved = inspirations.filter((i) => i.status !== "error");
  const score = kitScore(value, saved.length);
  const primary = value.colors[0] ?? null;
  const name = value.brandName.trim();
  const category = categoryFor(value.industry);
  const CategoryIcon = category ? CATEGORY_ICONS[category.id] : Coffee;
  const voices = VOICES.filter((v) => value.voice.includes(v.id));
  const pop = reduce
    ? {}
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 } };

  return (
    <div className="overflow-hidden rounded-[28px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] shadow-[var(--ds-card-shadow)]">
      {/* Cover in the brand's colours */}
      <motion.div
        className="relative h-24"
        animate={{
          background: primary
            ? `linear-gradient(135deg, ${primary} 0%, ${value.colors[1] ?? primary} 70%, ${value.colors[2] ?? value.colors[1] ?? primary} 100%)`
            : "linear-gradient(135deg, hsl(var(--foreground) / 0.06), hsl(var(--foreground) / 0.02))",
        }}
        transition={{ duration: reduce ? 0 : 0.5 }}
      >
        {!primary && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-card/80 px-2 py-0.5 text-[10.5px] text-muted-foreground">
            <Sparkles className="h-3 w-3" aria-hidden /> Live preview
          </span>
        )}
      </motion.div>
      <div className="relative px-5 pb-5">
        <div className="-mt-9 grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-[20px] border-4 border-[var(--ds-card-bg)] bg-card shadow-sm">
          <AnimatePresence mode="wait" initial={false}>
            {value.logo ? (
              <motion.img
                key="logo"
                {...pop}
                src={value.logo}
                alt=""
                className="max-h-[52px] max-w-[52px] object-contain"
              />
            ) : (
              <motion.span
                key="mono"
                {...pop}
                className="grid h-full w-full place-items-center text-[26px] font-semibold"
                style={primary ? { background: primary, color: inkOn(primary) } : undefined}
              >
                {name ? (
                  name.slice(0, 1).toUpperCase()
                ) : (
                  <Store className="h-6 w-6 text-muted-foreground" aria-hidden />
                )}
              </motion.span>
            )}
          </AnimatePresence>
        </div>

        <p
          className={cn(
            "mt-3 truncate text-[19px] font-semibold tracking-[-0.02em]",
            !name && "text-muted-foreground/60",
          )}
        >
          {name || "Your brand"}
        </p>
        <p
          className={cn(
            "mt-1 line-clamp-3 text-[13px] leading-snug",
            value.oneLiner.trim() ? "text-foreground/75" : "text-muted-foreground/60",
          )}
        >
          {value.oneLiner.trim() || "What you do, in one line."}
        </p>

        <div className="mt-3 flex min-h-[26px] flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {value.industry.trim() && (
              <motion.span
                key="cat"
                {...pop}
                className="inline-flex h-[26px] items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-2.5 text-[11.5px] font-medium"
              >
                <CategoryIcon className="h-3.5 w-3.5 text-primary-ink" aria-hidden />
                {value.industry.trim()}
              </motion.span>
            )}
            {voices.map((v) => (
              <motion.span
                key={v.id}
                {...pop}
                className="inline-flex h-[26px] items-center rounded-full border border-border/70 px-2.5 text-[11.5px]"
              >
                {v.label}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>

        <PreviewRow label="Colours">
          {value.colors.length ? (
            <div className="flex gap-1">
              {value.colors.map((c) => (
                <motion.span
                  key={c}
                  layout
                  className="h-6 flex-1 rounded-md first:flex-[2]"
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          ) : null}
        </PreviewRow>

        <PreviewRow label="For">
          {value.audience.trim() ? (
            <p className="line-clamp-2 text-[12.5px] text-foreground/75">{value.audience.trim()}</p>
          ) : null}
        </PreviewRow>

        <PreviewRow label="Inspiration">
          {saved.length ? (
            <div className="flex -space-x-2">
              {saved.slice(0, 5).map((i) =>
                i.preview ? (
                  <img
                    key={i.key}
                    src={i.preview}
                    alt=""
                    className="h-8 w-8 rounded-lg border-2 border-[var(--ds-card-bg)] object-cover"
                  />
                ) : (
                  <span
                    key={i.key}
                    className="grid h-8 w-8 place-items-center rounded-lg border-2 border-[var(--ds-card-bg)] bg-[var(--ds-well-bg)]"
                  >
                    <Globe className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                  </span>
                ),
              )}
              {saved.length > 5 && (
                <span className="grid h-8 w-8 place-items-center rounded-lg border-2 border-[var(--ds-card-bg)] bg-[var(--ds-well-bg)] text-[10.5px] font-semibold">
                  +{saved.length - 5}
                </span>
              )}
            </div>
          ) : null}
        </PreviewRow>

        <PreviewRow label="Rivals">
          {value.competitors.length ? (
            <p className="truncate text-[12.5px] text-foreground/75">
              {value.competitors.map((c) => c.name).join(" · ")}
            </p>
          ) : null}
        </PreviewRow>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[11.5px]">
            <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
              <Users className="h-3.5 w-3.5" aria-hidden /> How well Mox knows you
            </span>
            <span className="font-semibold tabular-nums">{score}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
            <motion.div
              className="ds-grad-bar h-full rounded-full"
              initial={false}
              animate={{ width: `${Math.max(4, score)}%` }}
              transition={{ type: "spring", stiffness: 140, damping: 24 }}
            />
          </div>
          <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground">
            {score >= 80
              ? "Plenty to go on. Posts will feel like you."
              : "Anything you skip can be added later in Brain."}
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 border-t border-border/50 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </span>
      {children ?? (
        <span className="h-2 w-16 rounded-full bg-[var(--ds-well-bg)]" aria-label="Not added yet" />
      )}
    </div>
  );
}

"use client";

import type { CSSProperties, ReactNode, Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, RefreshCw, Spinner } from "@/components/icons";
import type { Discoveries } from "@/lib/brand-extract-events";
import { normalizeHex, relLuminance } from "@/lib/color";
import { duration, ease } from "@/lib/motion";
import { faviconFor } from "@/lib/site-screenshot";
import { SCAN_PHASES } from "./phases";
import { BrandMark } from "./ui";
import { hostOf, normalizeUrl } from "./url";

export type ScanStatus = "idle" | "loading" | "ok" | "error";
export type ScanProgress = { stage: string; message: string; pct: number };

/** Server progress (pct) spanned by each phase — used to fill its segment. */
const PHASE_PCT: readonly [number, number][] = [
  [0, 48],
  [48, 56],
  [56, 72],
  [72, 92],
  [92, 100],
];

const HELIX = { rungs: 14, row: 13, amp: 46, cycle: 3.6, twist: 1 } as const;

export function ScanStage({
  url,
  status,
  progress,
  phase,
  discoveries,
  error,
  reduce,
  headingRef,
  onRetry,
  onEdit,
  onSkip,
}: {
  url: string;
  status: ScanStatus;
  progress: ScanProgress;
  phase: number;
  discoveries: Discoveries;
  error: string | null;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onRetry: () => void;
  onEdit: () => void;
  onSkip: () => void;
}) {
  const host = hostOf(url);
  const failed = status === "error";
  const complete = status === "ok";
  const active = Math.min(Math.max(phase, 0), SCAN_PHASES.length - 1);
  const pct = complete ? 100 : Math.round(Math.min(100, Math.max(0, progress.pct)));
  const sequenced = complete ? HELIX.rungs : Math.floor((pct / 100) * HELIX.rungs);
  const name = discoveries.site?.siteName || host;

  const title = failed
    ? "We couldn't read that site"
    : complete
      ? "Brand DNA ready"
      : SCAN_PHASES[active].label;
  const message = failed
    ? error
    : complete
      ? `Mellox now understands ${name}.`
      : progress.stage === "retry"
        ? progress.message
        : SCAN_PHASES[active].detail;

  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {failed ? `Scan failed. ${error ?? ""}` : complete ? "Scan complete." : title}
      </p>

      <div className="rounded-[28px] border border-border bg-card px-6 pb-6 pt-5 shadow-[0_32px_80px_-48px_hsl(var(--foreground)/0.45)] sm:px-8">
        <motion.div
          layoutId="site-address"
          transition={{ duration: duration.xslow, ease: ease.emphasized }}
          className="mx-auto flex h-9 w-fit max-w-full items-center gap-2 rounded-full border border-border bg-surface-2 pl-1.5 pr-3"
        >
          <BrandMark
            sources={[discoveries.site?.faviconUrl, faviconFor(normalizeUrl(url), 64)]}
            name={name}
            size={24}
            className="rounded-full"
          />
          <span className="truncate text-[13px] font-medium">{host}</span>
          <span aria-hidden className="shrink-0">
            {failed ? (
              <AlertCircle className="h-3.5 w-3.5 text-danger" />
            ) : complete ? (
              <Check className="h-3.5 w-3.5 text-primary" strokeWidth={2.5} />
            ) : (
              <Spinner className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </span>
        </motion.div>

        <Helix
          sequenced={sequenced}
          strandColor={brandStrandColor(discoveries)}
          scanning={status === "loading"}
          failed={failed}
          reduce={reduce}
        />

        <div className="mt-5 text-center">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-[19px] font-semibold leading-tight tracking-[-0.02em] outline-none"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={title}
                className="block"
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
              >
                {title}
              </motion.span>
            </AnimatePresence>
          </h1>
          <p
            className={`mx-auto mt-1.5 min-h-[20px] max-w-[34ch] text-[13px] leading-relaxed ${failed ? "text-foreground/80" : "text-muted-foreground"}`}
          >
            {message}
          </p>
        </div>

        {failed ? (
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium transition hover:bg-secondary"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Edit URL
            </button>
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-[13px] font-semibold text-primary-foreground transition hover:brightness-110"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
            </button>
          </div>
        ) : (
          <PhaseProgress active={active} pct={pct} complete={complete} />
        )}

        <Findings discoveries={discoveries} reduce={reduce} />
      </div>

      {!complete && (
        <button
          type="button"
          onClick={onSkip}
          className="mx-auto mt-4 block text-[12px] text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
        >
          Skip for now and enter Mellox
        </button>
      )}
    </div>
  );
}

/* ── Helix ─────────────────────────────────────────────────────────────────
   Rows fill in with color as the server reports progress, top to bottom, so
   the helix is a readout of the real scan rather than a decorative loop. */

function Helix({
  sequenced,
  strandColor,
  scanning,
  failed,
  reduce,
}: {
  sequenced: number;
  strandColor: string;
  scanning: boolean;
  failed: boolean;
  reduce: boolean;
}) {
  const { rungs, row, amp } = HELIX;
  const height = rungs * row;
  return (
    <div
      aria-hidden
      className="relative mx-auto mt-6"
      style={{ width: amp * 2 + 24, height, filter: failed ? "grayscale(1)" : undefined }}
    >
      {Array.from({ length: rungs }, (_, index) => {
        const offset = (index / rungs) * HELIX.twist;
        const done = index < sequenced;
        const idle = "hsl(var(--foreground) / 0.14)";
        return (
          <div key={index} className="absolute inset-x-0" style={{ top: index * row, height: row }}>
            <Rung
              offset={offset}
              color={done ? "hsl(var(--primary) / 0.35)" : "hsl(var(--foreground) / 0.07)"}
              paused={failed}
              reduce={reduce}
            />
            <Dot
              offset={offset}
              color={done ? "hsl(var(--primary))" : idle}
              paused={failed}
              reduce={reduce}
            />
            <Dot
              offset={offset + 0.5}
              color={done ? strandColor : idle}
              paused={failed}
              reduce={reduce}
            />
          </div>
        );
      })}

      {scanning && (
        <motion.div
          className="pointer-events-none absolute -inset-x-12 top-0 [mask-image:linear-gradient(90deg,transparent,#000_30%,#000_70%,transparent)]"
          initial={false}
          animate={{ y: Math.min(sequenced, rungs) * row }}
          transition={{ duration: duration.xslow, ease: ease.emphasized }}
        >
          <div
            className="absolute inset-x-0 bottom-0 h-7"
            style={{
              background: "linear-gradient(to bottom, transparent, hsl(var(--brand) / 0.14))",
            }}
          />
          <div
            className="absolute inset-x-0 bottom-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, hsl(var(--brand)) 30%, hsl(var(--brand)) 70%, transparent)",
            }}
          />
        </motion.div>
      )}
    </div>
  );
}

function animation(name: string, offset: number, paused: boolean): CSSProperties {
  return {
    animationName: name,
    animationDuration: `${HELIX.cycle}s`,
    animationIterationCount: "infinite",
    animationDelay: `${-offset * HELIX.cycle}s`,
    animationPlayState: paused ? "paused" : "running",
  };
}

function Dot({
  offset,
  color,
  paused,
  reduce,
}: {
  offset: number;
  color: string;
  paused: boolean;
  reduce: boolean;
}) {
  const theta = offset * 2 * Math.PI;
  const depth = Math.cos(theta);
  const position: CSSProperties = reduce
    ? { transform: `translateX(${HELIX.amp * Math.sin(theta)}px)` }
    : { ...animation("dna-x", offset, paused), ["--dna-amp" as string]: `${HELIX.amp}px` };
  const body: CSSProperties = reduce
    ? { transform: `scale(${0.75 + 0.25 * depth})`, opacity: 0.65 + 0.35 * depth }
    : animation("dna-depth", offset, paused);
  return (
    <span className="absolute left-1/2 top-1/2 -ml-[4px] -mt-[4px] h-2 w-2" style={position}>
      <span
        className="block h-2 w-2 rounded-full transition-[background-color] duration-500"
        style={{ ...body, backgroundColor: color }}
      />
    </span>
  );
}

function Rung({
  offset,
  color,
  paused,
  reduce,
}: {
  offset: number;
  color: string;
  paused: boolean;
  reduce: boolean;
}) {
  const style: CSSProperties = reduce
    ? { transform: `scaleX(${Math.abs(Math.sin(offset * 2 * Math.PI))})` }
    : animation("dna-rung", offset, paused);
  return (
    <span
      className="absolute left-1/2 top-1/2 h-px transition-[background-color] duration-500"
      style={{ ...style, width: HELIX.amp * 2, marginLeft: -HELIX.amp, backgroundColor: color }}
    />
  );
}

/** The brand's own color for the second strand, once the scan has found one. */
function brandStrandColor({ identity, site }: Discoveries): string {
  const candidates = [...(identity?.colors ?? []), site?.themeColor]
    .map((hex) => normalizeHex(hex))
    .filter((hex): hex is string => !!hex);
  const usable = candidates.find((hex) => {
    const l = relLuminance(hex);
    return l > 0.03 && l < 0.7;
  });
  return usable ?? "hsl(var(--primary) / 0.5)";
}

/* ── Progress ──────────────────────────────────────────────────────────── */

function PhaseProgress({
  active,
  pct,
  complete,
}: {
  active: number;
  pct: number;
  complete: boolean;
}) {
  return (
    <div className="mt-5">
      <div className="flex gap-1">
        {PHASE_PCT.map(([start, end], index) => {
          const fill =
            complete || index < active
              ? 1
              : index > active
                ? 0
                : Math.min(1, Math.max(0, (pct - start) / (end - start)));
          return (
            <span
              key={SCAN_PHASES[index].id}
              className="relative h-1 flex-1 overflow-hidden rounded-full bg-border"
            >
              <motion.span
                className="absolute inset-0 origin-left rounded-full bg-primary"
                initial={false}
                animate={{ scaleX: fill }}
                transition={{ duration: duration.xslow, ease: ease.emphasized }}
              />
            </span>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[11.5px] text-muted-foreground">
        <span>{complete ? "Complete" : `Step ${active + 1} of ${SCAN_PHASES.length}`}</span>
        <span className="tabular-nums">{pct}%</span>
      </div>
    </div>
  );
}

/* ── Findings ──────────────────────────────────────────────────────────── */

function Findings({ discoveries, reduce }: { discoveries: Discoveries; reduce: boolean }) {
  const { site, pages, identity, market } = discoveries;
  const colors = identity?.colors.length
    ? identity.colors.slice(0, 5)
    : site?.themeColor
      ? [site.themeColor]
      : [];
  const font = identity?.fonts[0];
  const socials = new Set((identity?.socialPlatforms ?? []).map((p) => (p === "twitter" ? "x" : p)))
    .size;

  const items: { key: string; content: ReactNode }[] = [];
  if (colors.length)
    items.push({
      key: "colors",
      content: (
        <>
          <span className="flex -space-x-1">
            {colors.map((hex) => (
              <span
                key={hex}
                className="h-3.5 w-3.5 rounded-full ring-2 ring-card"
                style={{ background: hex }}
              />
            ))}
          </span>
          {identity ? `${identity.colors.length} colors` : "Theme color"}
        </>
      ),
    });
  if (font)
    items.push({
      key: "font",
      content: (
        <>
          <span
            className="leading-none"
            style={{ fontFamily: `"${font.replace(/["\\]/g, "")}", var(--font-sans)` }}
          >
            Aa
          </span>
          <span className="max-w-[9rem] truncate">{font}</span>
        </>
      ),
    });
  if (pages) items.push({ key: "pages", content: `${pages.paths.length + 1} pages` });
  if (socials)
    items.push({ key: "socials", content: `${socials} social profile${socials === 1 ? "" : "s"}` });
  if (market?.mentions) items.push({ key: "mentions", content: `${market.mentions} web mentions` });

  return (
    <div className="mt-5 border-t border-border pt-4">
      <p className="text-center text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        Discovered
      </p>
      <ul className="mt-2.5 flex min-h-[64px] flex-wrap content-start justify-center gap-1.5">
        {items.length === 0 ? (
          <li className="pt-1.5 text-[12px] text-muted-foreground/70">
            Findings appear here as Mellox reads your site
          </li>
        ) : (
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.li
                key={item.key}
                layout={!reduce}
                initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: duration.medium, ease: ease.emphasized }}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-2.5 text-[12px] text-foreground/85"
              >
                {item.content}
              </motion.li>
            ))}
          </AnimatePresence>
        )}
      </ul>
    </div>
  );
}

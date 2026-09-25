"use client";

import { motion } from "framer-motion";
import { ExternalLink, Search, Spinner } from "@/components/icons";
import { SiteIcon } from "@/components/app/surface/SiteIcon";
import type { CompetitorView } from "@/lib/competitors.functions";

export type CompetitorResearchStatus = "idle" | "searching" | "ready" | "error";

/** A small readout within the existing scan and Brand DNA review. */
export function CompetitorResearchPreview({
  competitors,
  status,
  compact = false,
  reduce,
}: {
  competitors: CompetitorView[];
  status: CompetitorResearchStatus;
  compact?: boolean;
  reduce: boolean;
}) {
  const visible = competitors.slice(0, compact ? 3 : 4);
  const pending = status === "idle" || status === "searching";
  return (
    <section
      aria-label="Competitor research"
      className={compact ? "mt-4 border-t border-border pt-4" : ""}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Search className="h-3.5 w-3.5" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold">Competitor research</p>
            <p className="text-[11px] text-muted-foreground" aria-live="polite">
              {visible.length
                ? `${competitors.length} verified ${competitors.length === 1 ? "company" : "companies"}`
                : status === "error"
                  ? "Research will continue in Mellox"
                  : pending
                    ? "Finding company websites"
                    : "No verified matches yet"}
            </p>
          </div>
        </div>
        {pending && (
          <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-hidden />
        )}
      </div>
      {visible.length ? (
        <ul className={`mt-3 ${compact ? "flex flex-wrap gap-1.5" : "space-y-1"}`}>
          {visible.map((competitor, index) => (
            <motion.li
              key={competitor.id}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25, delay: reduce ? 0 : index * 0.04 }}
            >
              <a
                href={competitor.url ?? `https://${competitor.domain}`}
                target="_blank"
                rel="noreferrer noopener"
                className={`group flex min-w-0 items-center gap-2 rounded-xl border border-border/70 bg-surface-2/70 transition hover:border-primary/40 hover:bg-primary/[0.04] ${compact ? "max-w-[140px] px-2 py-1.5" : "px-2.5 py-2"}`}
                title={`Open ${competitor.name} website`}
              >
                <SiteIcon domain={competitor.domain} size={compact ? 22 : 28} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium">
                  {competitor.name}
                </span>
                {!compact && (
                  <ExternalLink
                    className="h-3 w-3 shrink-0 text-muted-foreground group-hover:text-primary"
                    aria-hidden
                  />
                )}
              </a>
            </motion.li>
          ))}
        </ul>
      ) : pending ? (
        <div className="mt-3 flex gap-1.5" aria-hidden>
          {[0, 1, 2].map((item) => (
            <span
              key={item}
              className="h-7 w-20 rounded-lg bg-foreground/[0.05] motion-safe:animate-pulse"
              style={{ animationDelay: `${item * 120}ms` }}
            />
          ))}
        </div>
      ) : null}
      {!compact && competitors.length > visible.length && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          +{competitors.length - visible.length} more in Mellox
        </p>
      )}
    </section>
  );
}

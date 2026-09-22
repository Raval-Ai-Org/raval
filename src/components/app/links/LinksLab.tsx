"use client";
// Development-only visual QA for Backlink Growth.
//
// Renders the presentational pieces with sample data so the design can be
// checked without a workspace, a sign-in or a real order. Every string here is
// invented; nothing touches the provider or the database.
import { useState } from "react";

import { Link2, Plus, Sparkles } from "@/components/icons";
import {
  btnGhost,
  btnPrimary,
  btnQuiet,
  CountUp,
  Journey,
  JOURNEY,
  type JourneyKey,
  Meta,
  Money,
  ORDER_LABELS,
  ORDER_MEANING,
  Rise,
  Section,
  StatusPill,
} from "./links-ui";
import { PlacementCard } from "./PlacementCard";
import type { OpportunityView } from "@/server/fns/links";

const SAMPLE: OpportunityView[] = [
  {
    donorId: 1,
    domain: "smallbusinessdaily.com",
    credits: 1600,
    usd: 16,
    quality: "strong",
    qualityLabel: "Strong site",
    authority: 61,
    referringDomains: 27_128,
    rankingKeywords: 4_210,
    category: "Business",
    samplePage: "https://smallbusinessdaily.com/a",
    topic: {
      summary: "Covers bookkeeping, payroll and tax deadlines for owner-run businesses.",
      fit: "Its readers already run the kind of small team your pricing page is written for, so an article about project tools would not look out of place.",
      verdict: "good",
      basis: "page",
    },
  },
  {
    donorId: 2,
    domain: "thedailyledger.net",
    credits: 1600,
    usd: 16,
    quality: "solid",
    qualityLabel: "Solid site",
    authority: 44,
    referringDomains: 3_902,
    rankingKeywords: 870,
    category: null,
    samplePage: "https://thedailyledger.net/b",
    topic: {
      summary: "General business and finance news, updated daily.",
      fit: "Broad rather than targeted, but an article on team software would sit comfortably alongside its usual coverage.",
      verdict: "workable",
      basis: "page",
    },
  },
  {
    donorId: 3,
    domain: "regional-gazette.org",
    credits: 1600,
    usd: 16,
    quality: "modest",
    qualityLabel: "Smaller site",
    authority: null,
    referringDomains: 412,
    rankingKeywords: null,
    category: "News",
    samplePage: null,
    topic: {
      summary: "Local news for a single county — mostly council and community stories.",
      fit: "Nothing here overlaps with software buyers, so a link would be read by the wrong audience.",
      verdict: "poor",
      basis: "domain",
    },
  },
];

export function LinksLab() {
  const [selected, setSelected] = useState<number[]>([1]);
  const [stage, setStage] = useState<JourneyKey>("publishing");

  return (
    <div className="min-h-screen bg-background px-4 py-10 sm:px-8">
      <div className="mx-auto w-full max-w-3xl space-y-14">
        <header>
          <Meta>Development only</Meta>
          <h1 className="text-[30px] font-semibold tracking-tight text-foreground">
            Backlink Growth — visual QA
          </h1>
        </header>

        {/* ── First run ─────────────────────────────────────────────────── */}
        <Section title="First run">
          <span id="first-run" />
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="mx-auto flex w-full max-w-xl flex-col items-center py-8 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-surface">
                <Link2 className="h-6 w-6 text-primary" aria-hidden />
              </span>
              <h2 className="mt-6 text-[30px] font-semibold leading-tight tracking-tight text-foreground">
                Get other sites linking to you
              </h2>
              <p className="mt-3 text-[15.5px] leading-relaxed text-muted-foreground">
                A backlink is another website pointing at yours. Search engines treat them as votes,
                so a handful of good ones makes your pages much easier to find.
              </p>
              <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button type="button" className={btnPrimary}>
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Find sites
                </button>
                <button type="button" className={btnGhost}>
                  <Money usd={128.4} cents /> balance
                </button>
              </div>
              <Meta className="mt-5 block">9,583 sites available</Meta>
            </div>
          </div>
        </Section>

        {/* ── Overview hero ─────────────────────────────────────────────── */}
        <Section title="Overview">
          <span id="overview" />
          <Rise>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-1 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div>
                  <p className="text-[13px] uppercase tracking-wide text-muted-foreground">
                    Live backlinks
                  </p>
                  <div className="mt-1 flex items-baseline gap-3">
                    <CountUp
                      value={7}
                      className="text-[44px] font-semibold leading-none tracking-tight text-foreground"
                    />
                    <span className="text-[13px] font-medium text-success">verified</span>
                  </div>
                  <p className="mt-2 max-w-sm text-[13.5px] leading-relaxed text-muted-foreground">
                    Each one was confirmed by Mellox opening the published page.
                  </p>
                </div>
                <div className="rounded-xl border border-border px-4 py-3 text-left">
                  <Meta>Balance</Meta>
                  <Money
                    usd={128.4}
                    cents
                    className="mt-0.5 block text-[20px] font-semibold tracking-tight text-foreground"
                  />
                  <Meta className="mt-0.5 block">
                    <Money usd={32} cents /> reserved
                  </Meta>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-4">
                <div>
                  <Meta>In progress</Meta>
                  <p className="text-[15px] tabular-nums text-foreground">2</p>
                </div>
                <div>
                  <Meta>Never appeared · refunded</Meta>
                  <p className="text-[15px] tabular-nums text-foreground">1</p>
                </div>
              </div>
            </div>
          </Rise>

          <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-card p-6 shadow-1">
            <div className="min-w-0">
              <h3 className="text-[16px] font-semibold tracking-tight text-foreground">
                Buy more placements
              </h3>
              <p className="mt-1 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
                Pick a page, choose the sites, approve the article. 9,583 sites available.
              </p>
            </div>
            <button type="button" className={btnPrimary}>
              <Plus className="h-4 w-4" aria-hidden />
              New order
            </button>
          </div>
        </Section>

        {/* ── Journey ───────────────────────────────────────────────────── */}
        <Section title="Order journey" description="Click a stage to preview it.">
          <span id="journey" />
          <div className="rounded-2xl border border-border bg-card p-6 shadow-1 sm:p-7">
            <Journey reached={stage} />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {JOURNEY.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStage(s.key)}
                className={btnQuiet}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Section>

        {/* ── Status pills ──────────────────────────────────────────────── */}
        <Section title="Every order state">
          <span id="states" />
          <div className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-6">
            {Object.keys(ORDER_LABELS).map((status) => (
              <StatusPill key={status} status={status} label={ORDER_LABELS[status]} />
            ))}
          </div>
          <ul className="space-y-1.5">
            {Object.entries(ORDER_MEANING).map(([status, meaning]) => (
              <li key={status} className="text-[13px] text-muted-foreground">
                <span className="font-medium text-foreground">{ORDER_LABELS[status]}</span> —{" "}
                {meaning}
              </li>
            ))}
          </ul>
        </Section>

        {/* ── Placement cards ───────────────────────────────────────────── */}
        <Section
          id="cards"
          title="Placement cards"
          description="Selected, unselected, and a weak fit. Click to toggle."
        >
          <div className="space-y-3">
            {SAMPLE.map((placement, index) => (
              <PlacementCard
                key={placement.donorId}
                placement={placement}
                index={index}
                selected={selected.includes(placement.donorId)}
                onToggle={() =>
                  setSelected((current) =>
                    current.includes(placement.donorId)
                      ? current.filter((id) => id !== placement.donorId)
                      : [...current, placement.donorId],
                  )
                }
              />
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

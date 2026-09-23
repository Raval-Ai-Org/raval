"use client";

// Overview — the one screen that answers "how do AI engines see my site?".
// Top row: the score and which engines can read the site. Then the six scored
// areas as rings, then the fixes worth doing first beside what engines see on
// the homepage. Everything deeper lives one click away in Issues.

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CheckCircle,
  ChevronDown,
  MessageSquare,
  Wand,
} from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import type { GeoScanView } from "@/lib/geo/contracts";
import { fixRecipeFor } from "@/lib/geo/fix-recipes";
import type { ProbeSummary } from "@/lib/geo/probes";
import {
  CATEGORY_BY_ID,
  type CategoryScore,
  type GeoAction,
  type GeoCategoryId,
} from "@/lib/geo/types";
import { Tile } from "../surface/SurfaceLayout";
import { FixDrawer } from "./FixDrawer";
import { useScanFindings } from "./use-scan-findings";
import {
  CATEGORY_ICON,
  Chip,
  displayUrl,
  EASE,
  EngineMark,
  ghostBtn,
  PriorityChip,
  primaryBtn,
  ScoreRing,
  scoreTone,
  scoreVerdict,
  Sparkline,
  StatusGlyph,
  TONE,
} from "./geo-ui";

const ENGINE_STATE = {
  open: { label: "Allowed", tone: "success" },
  // No robots.txt rules for this engine: crawling isn't blocked, but nothing grants it either.
  unknown: { label: "No rules", tone: "muted" },
  partial: { label: "Partly blocked", tone: "warning" },
  blocked: { label: "Blocked", tone: "destructive" },
} as const;

const EFFORT_LABEL = { low: "Quick", medium: "Medium effort", high: "Bigger job" } as const;

export function buildReport(scan: GeoScanView): string {
  const r = scan.report!;
  const lines = [
    `# AI Visibility report — ${displayUrl(scan.origin)}`,
    "",
    `Score: ${r.overall}/100 (${scoreVerdict(r.overall).label}) · ${r.counts.pagesCrawled} pages · scanned ${new Date(scan.completedAt ?? scan.createdAt).toLocaleString()}`,
    "",
    "## Scores",
    ...r.categories.map((c) => `- ${c.name}: ${c.score}/100`),
    "",
    "## AI engine access",
    ...r.engines.map(
      (e) =>
        `- ${e.name}: ${ENGINE_STATE[e.state].label}${e.blocked.length ? ` (blocks ${e.blocked.join(", ")})` : ""}`,
    ),
    "",
    "## Fix next",
    ...r.actions
      .slice(0, 15)
      .map(
        (a, i) =>
          `${i + 1}. [${a.priority}] ${a.title} — ${a.detail}${a.pointsLost ? ` (+${a.pointsLost} pts)` : ""}`,
      ),
  ];
  return `${lines.join("\n").trim()}\n`;
}

function CategoryTile({
  category,
  open,
  onToggle,
  i,
}: {
  category: CategoryScore;
  open: boolean;
  onToggle: () => void;
  i: number;
}) {
  const Icon = CATEGORY_ICON[category.id];
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.04 + i * 0.03, duration: 0.3, ease: EASE }}
      className={cn(
        "flex min-w-0 flex-col items-center gap-2 rounded-[20px] border px-2 py-4 text-center transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        open
          ? "border-primary/50 bg-primary/[0.06]"
          : "border-border/50 bg-surface-3 hover:border-primary/35 dark:border-white/[0.06] dark:bg-white/[0.035]",
      )}
    >
      <ScoreRing value={category.score} size={56} label={category.name} />
      <span className="flex max-w-full items-center gap-1 text-[12.5px] font-medium text-foreground/85">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={2.1} />
        <span className="truncate">{CATEGORY_BY_ID[category.id].short}</span>
      </span>
    </motion.button>
  );
}

function CategoryExplanation({
  category,
  onOpenFindings,
}: {
  category: CategoryScore;
  onOpenFindings: (filter: { category?: GeoCategoryId; ruleId?: string }) => void;
}) {
  const [showPassed, setShowPassed] = useState(false);
  const deductions = category.rules
    .filter((r) => r.status === "warn" || r.status === "fail")
    .sort((a, b) => b.pointsLost - a.pointsLost);
  const passed = category.rules.filter((r) => r.status === "pass");
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="overflow-hidden"
    >
      <Tile className="mt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-foreground">{category.name}</div>
            <div className="text-[12.5px] text-muted-foreground">
              {CATEGORY_BY_ID[category.id].blurb}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            <Chip tone="success">{passed.length} passing</Chip>
            {deductions.length > 0 && <Chip tone="warning">{deductions.length} to fix</Chip>}
          </div>
        </div>
        {deductions.length ? (
          <ul className="mt-3 divide-y divide-border/40">
            {deductions.map((r) => (
              <li key={r.ruleId}>
                <button
                  type="button"
                  onClick={() => onOpenFindings({ ruleId: r.ruleId })}
                  className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl py-2.5 text-left hover:bg-foreground/[0.03]"
                >
                  <StatusGlyph status={r.status} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-foreground/90">
                      {r.title}
                    </span>
                    {r.scope === "page" && r.applicable > 1 && (
                      <span className="block text-[12px] text-muted-foreground">
                        {r.failed + r.warned} of {r.applicable} pages
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-[12px] font-semibold tabular-nums text-destructive">
                      −{r.pointsLost}
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-[13px] text-foreground/85">
            <CheckCircle className="h-4 w-4 text-success" /> Every check passes.
          </div>
        )}
        {passed.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPassed((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassed ? "Hide" : "Show"} passing checks
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showPassed && "rotate-180")}
              />
            </button>
            {showPassed && (
              <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {passed.map((r) => (
                  <li
                    key={r.ruleId}
                    className="flex min-w-0 items-center gap-2 text-[12.5px] text-foreground/80"
                  >
                    <StatusGlyph status="pass" className="h-3.5 w-3.5" />
                    <span className="truncate" title={r.detail}>
                      {r.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Tile>
    </motion.div>
  );
}

function ActionRow({
  action,
  scan,
  brandName,
  onOpenFindings,
}: {
  action: GeoAction;
  scan: GeoScanView;
  brandName: string | null;
  onOpenFindings: (filter: { ruleId?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const recipe = action.fixId
    ? fixRecipeFor(action.fixId, {
        url: scan.origin,
        brandName,
        description: scan.report?.snapshot.description,
      })
    : null;
  const ask = () =>
    emitAppEvent("chat:prefill", {
      text: `Help me fix this AI visibility issue on ${displayUrl(scan.origin)}: "${action.title}". ${action.detail} Give me exact, step-by-step changes for my site.`,
      focus: true,
    });
  const meta = [
    action.pointsLost > 0 ? `+${action.pointsLost} pts` : null,
    action.affectedPages > 1 ? `${action.affectedPages} pages` : null,
    EFFORT_LABEL[action.effort],
  ].filter(Boolean);
  const iconBtn =
    "grid h-8 w-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/[0.07] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40";
  return (
    <li className={cn("rounded-2xl transition-colors", open && "bg-foreground/[0.03]")}>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5 sm:grid-cols-[92px_minmax(0,1fr)_auto]">
        <div className="hidden sm:block">
          <PriorityChip priority={action.priority} />
        </div>
        <button
          type="button"
          onClick={() => onOpenFindings({ ruleId: action.ruleId })}
          className="min-w-0 text-left"
          title={action.detail}
        >
          <span className="block truncate text-[13.5px] font-medium text-foreground">
            {action.title}
          </span>
          <span className="block truncate text-[12px] text-muted-foreground">
            {meta.join(" · ")}
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5">
          {recipe && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? "Hide the fix" : "Show the fix"}
              title={open ? "Hide the fix" : "Show the fix"}
              onClick={() => setOpen((v) => !v)}
              className={cn(iconBtn, open && "bg-primary/12 text-primary")}
            >
              <Wand className="h-4 w-4" strokeWidth={2.1} />
            </button>
          )}
          <button
            type="button"
            onClick={ask}
            aria-label="Ask Mellox"
            title="Ask Mellox"
            className={iconBtn}
          >
            <MessageSquare className="h-4 w-4" strokeWidth={2.1} />
          </button>
          <button
            type="button"
            onClick={() => onOpenFindings({ ruleId: action.ruleId })}
            className={cn(ghostBtn, "ml-1 h-8 px-3 text-[12px]")}
          >
            Fix
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && recipe && <FixDrawer recipe={recipe} safety={action.safety} />}
      </AnimatePresence>
    </li>
  );
}

function ProbesPanel({ probes }: { probes: ProbeSummary | { error: string } }) {
  if ("error" in probes) {
    return (
      <Tile className="text-[13px] text-muted-foreground">
        AI answer checks didn&apos;t finish: {probes.error}
      </Tile>
    );
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <Tile>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Mentioned", pct(probes.mentionRate)],
          ["Cited", pct(probes.citationRate)],
          ["Answers", String(probes.answers)],
          ["Questions", String(probes.queries)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[12px] text-muted-foreground">{label}</div>
            <div className="text-[22px] font-semibold tabular-nums text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-[12.5px]">
          <thead className="text-[11.5px] text-muted-foreground">
            <tr>
              <th className="py-1.5 pr-3 font-medium">Engine</th>
              <th className="py-1.5 pr-3 font-medium">Question</th>
              <th className="py-1.5 pr-3 font-medium">Mentioned</th>
              <th className="py-1.5 font-medium">Cited</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/40">
            {probes.results.map((r, i) => (
              <tr key={`${r.engine}-${i}`}>
                <td className="py-2 pr-3 font-medium text-foreground/90">{r.engine}</td>
                <td className="py-2 pr-3 text-foreground/80">{r.query.text}</td>
                <td className="py-2 pr-3">
                  {r.status === "error" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <StatusGlyph status={r.mentioned ? "pass" : "fail"} />
                  )}
                </td>
                <td className="py-2">
                  {r.status === "error" ? (
                    <span className="text-muted-foreground" title={r.error}>
                      —
                    </span>
                  ) : (
                    <StatusGlyph status={r.cited ? "pass" : "fail"} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {probes.competitorDomains.length > 0 && (
        <div className="mt-3 text-[12px] text-muted-foreground">
          Cited instead:{" "}
          {probes.competitorDomains
            .slice(0, 6)
            .map((d) => `${d.domain} (${d.count})`)
            .join(" · ")}
        </div>
      )}
      <div className="mt-2 text-[11.5px] text-muted-foreground/80">
        A sample — answers vary by person, place and time.
      </div>
    </Tile>
  );
}

function SectionTitle({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex min-h-8 items-center justify-between gap-3 px-1">
      <h4 className="text-[15px] font-semibold tracking-tight text-foreground">{children}</h4>
      {action}
    </div>
  );
}

export function OverviewTab({
  workspaceId,
  scan,
  previousScore,
  sparkValues,
  brandName,
  onOpenFindings,
}: {
  workspaceId: string;
  scan: GeoScanView;
  previousScore: number | null;
  sparkValues: number[];
  brandName: string | null;
  onOpenFindings: (filter: {
    category?: GeoCategoryId;
    ruleId?: string;
    fixAll?: boolean;
    findingId?: string;
  }) => void;
}) {
  const report = scan.report!;
  const scanFindings = useScanFindings(workspaceId, scan.id);
  const openFindings = scanFindings.findings?.filter(
    (f) => f.state !== "resolved" && f.state !== "dismissed",
  );
  const fixableCount = openFindings?.filter((f) => f.fixMode !== "manual").length ?? null;
  const [openCategory, setOpenCategory] = useState<GeoCategoryId | null>(null);
  const [showAll, setShowAll] = useState(false);
  const verdict = scoreVerdict(report.overall);
  const delta = previousScore === null ? null : report.overall - previousScore;
  const openCat = useMemo(
    () => report.categories.find((c) => c.id === openCategory) ?? null,
    [report, openCategory],
  );
  const actions = showAll ? report.actions : report.actions.slice(0, 5);
  const readable = report.engines.filter((e) => e.state === "open" || e.state === "unknown").length;

  return (
    <div className="space-y-6">
      {/* Score + engines */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <Tile className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-primary/10 blur-3xl"
          />
          <div className="relative flex items-center gap-5">
            <ScoreRing value={report.overall} size={124} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-muted-foreground">
                AI visibility score
              </div>
              <div
                className={cn(
                  "mt-0.5 text-[26px] font-semibold leading-tight tracking-tight",
                  TONE[scoreTone(report.overall)].text,
                )}
              >
                {verdict.label}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {delta === null ? (
                  <Chip tone="muted">First scan</Chip>
                ) : delta === 0 ? (
                  <Chip tone="muted">No change</Chip>
                ) : (
                  <Chip tone={delta > 0 ? "success" : "destructive"}>
                    {delta > 0 ? (
                      <ArrowUp className="h-3 w-3" />
                    ) : (
                      <ArrowDown className="h-3 w-3" />
                    )}
                    {delta > 0 ? "+" : ""}
                    {delta}
                  </Chip>
                )}
                <Sparkline values={sparkValues} />
              </div>
            </div>
          </div>
          <div className="relative mt-5 grid grid-cols-3 gap-2">
            {(
              [
                ["Passing", report.counts.passed, "success"],
                ["To improve", report.counts.warned, "warning"],
                ["Failing", report.counts.failed, "destructive"],
              ] as const
            ).map(([label, value, tone]) => (
              <button
                key={label}
                type="button"
                onClick={() => onOpenFindings({})}
                className="rounded-2xl bg-foreground/[0.04] px-3 py-2.5 text-left transition-colors hover:bg-foreground/[0.07]"
              >
                <div className={cn("text-[20px] font-semibold tabular-nums", TONE[tone].text)}>
                  {value}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">{label}</div>
              </button>
            ))}
          </div>
          {!!fixableCount && (
            <button
              type="button"
              onClick={() => onOpenFindings({ fixAll: true })}
              className={cn(primaryBtn, "relative mt-4 h-10 w-full text-[13.5px]")}
            >
              <Wand className="h-4 w-4" strokeWidth={2.2} /> Fix {fixableCount} automatically
            </button>
          )}
        </Tile>

        <Tile>
          <div className="flex items-baseline justify-between gap-3">
            <h4 className="text-[15px] font-semibold tracking-tight text-foreground">AI engines</h4>
            <span className="text-[12.5px] text-muted-foreground">
              {readable} of {report.engines.length} can read you
            </span>
          </div>
          <ul className="mt-3 divide-y divide-border/40">
            {report.engines.map((e) => {
              const state = ENGINE_STATE[e.state];
              return (
                <li
                  key={e.id}
                  title={
                    e.state === "partial"
                      ? `Blocks ${e.blocked.join(", ")}`
                      : `Crawlers: ${e.bots.join(", ")}`
                  }
                  className="flex min-w-0 items-center gap-3 py-2"
                >
                  <EngineMark id={e.id} name={e.name} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-foreground">
                    {e.name}
                  </span>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[12px] font-medium",
                      TONE[state.tone].text,
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", TONE[state.tone].bar)} />
                    {state.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Tile>
      </div>

      {/* Scored areas */}
      <div>
        <SectionTitle>Score by area</SectionTitle>
        <div className="grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-6">
          {report.categories.map((c, i) => (
            <CategoryTile
              key={c.id}
              category={c}
              i={i}
              open={openCategory === c.id}
              onToggle={() => setOpenCategory(openCategory === c.id ? null : c.id)}
            />
          ))}
        </div>
        <AnimatePresence initial={false}>
          {openCat && (
            <CategoryExplanation
              key={openCat.id}
              category={openCat}
              onOpenFindings={onOpenFindings}
            />
          )}
        </AnimatePresence>
      </div>

      {/* Fixes + snapshot */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <SectionTitle
            action={
              report.actions.length > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenFindings({})}
                  className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
                >
                  All issues <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )
            }
          >
            Fix first
          </SectionTitle>
          {report.actions.length === 0 ? (
            <Tile className="flex items-center gap-3">
              <CheckCircle className="h-5 w-5 shrink-0 text-success" strokeWidth={2.2} />
              <span className="text-[13.5px] text-foreground/90">Nothing to fix. Nice work.</span>
            </Tile>
          ) : (
            <Tile className="p-1.5 sm:p-2">
              <ul className="space-y-0.5">
                {actions.map((a) => (
                  <ActionRow
                    key={a.ruleId}
                    action={a}
                    scan={scan}
                    brandName={brandName}
                    onOpenFindings={onOpenFindings}
                  />
                ))}
              </ul>
              {report.actions.length > 5 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="mt-1 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground"
                >
                  {showAll ? "Show less" : `Show ${report.actions.length - 5} more`}
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")}
                  />
                </button>
              )}
            </Tile>
          )}
        </div>

        <div className="min-w-0">
          <SectionTitle>What AI sees</SectionTitle>
          <Tile className="space-y-4">
            {(
              [
                ["Title", report.snapshot.title],
                ["Description", report.snapshot.description],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="min-w-0">
                <div className="text-[12px] font-medium text-muted-foreground">{label}</div>
                <p className="mt-0.5 line-clamp-2 break-words text-[13.5px] text-foreground/90">
                  {value?.trim() || <span className="text-destructive">Missing</span>}
                </p>
              </div>
            ))}
            <div>
              <div className="text-[12px] font-medium text-muted-foreground">Schema</div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {report.snapshot.schemaTypes.length ? (
                  report.snapshot.schemaTypes.slice(0, 6).map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-primary/10 px-2 py-0.5 text-[11.5px] font-medium text-primary"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-[13.5px] text-destructive">Missing</span>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 border-t border-border/50 pt-4">
              {[
                ["Words", report.snapshot.words.toLocaleString()],
                ["Sitemap", report.snapshot.sitemapUrls.toLocaleString()],
                ["llms.txt", report.snapshot.llmsTxt ? "Yes" : "Missing"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="truncate text-[12px] text-muted-foreground">{label}</dt>
                  <dd
                    className={cn(
                      "text-[16px] font-semibold tabular-nums",
                      value === "Missing" ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </Tile>
        </div>
      </div>

      {/* AI answer checks — only when they were run for this scan */}
      {(scan.probes || scan.probesRequested) && (
        <div>
          <SectionTitle>AI answers</SectionTitle>
          {scan.probes ? (
            <ProbesPanel probes={scan.probes} />
          ) : (
            <Tile className="text-[13px] text-muted-foreground">
              {scan.stage === "probing" ? "Asking AI engines now…" : "No answers were recorded."}
            </Tile>
          )}
        </div>
      )}

      {report.rendering && report.rendering.needed > 0 && !report.rendering.available && (
        <p className="px-1 text-[12px] text-muted-foreground">
          {report.rendering.needed} page{report.rendering.needed === 1 ? "" : "s"} need JavaScript
          to show content, so their content checks used the raw HTML.
        </p>
      )}
    </div>
  );
}

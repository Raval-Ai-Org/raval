"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CheckCircle,
  ChevronDown,
  Copy,
  Eye,
  Globe,
  ListTree,
  MessageSquare,
  Radio,
  Target,
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
import { FixDrawer } from "./FixDrawer";
import {
  CATEGORY_ICON,
  Chip,
  copyText,
  displayUrl,
  EASE,
  ghostBtn,
  MiniBar,
  PanelHeading,
  PriorityChip,
  primaryBtn,
  relativeTime,
  SAFETY_META,
  ScoreRing,
  scoreTone,
  scoreVerdict,
  Sparkline,
  StatusGlyph,
  TONE,
} from "./geo-ui";

const ENGINE_STATE = {
  open: { label: "Allowed", tone: "success" },
  unknown: { label: "Allowed", tone: "success" },
  partial: { label: "Partly blocked", tone: "warning" },
  blocked: { label: "Blocked", tone: "destructive" },
} as const;

function buildReport(scan: GeoScanView): string {
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
  const tone = scoreTone(category.score);
  return (
    <motion.button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 + i * 0.03, duration: 0.3, ease: EASE }}
      className={cn(
        "group min-w-0 rounded-xl border px-3 py-2.5 text-left transition-colors hover:bg-card",
        open
          ? "border-primary/50 bg-card"
          : "border-border/60 bg-background/50 hover:border-primary/40",
      )}
    >
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
        <span className="truncate text-[11.5px] font-medium">
          {CATEGORY_BY_ID[category.id].short}
        </span>
      </div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <span className={cn("text-[19px] font-semibold tabular-nums", TONE[tone].text)}>
          {category.score}
        </span>
        <span className="text-[10.5px] text-muted-foreground/70">/100</span>
      </div>
      <div className="mt-1.5">
        <MiniBar value={category.score} />
      </div>
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
  const na = category.rules.filter((r) => r.status === "na");
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.26, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="mt-3 rounded-xl border border-border/60 bg-background/60 p-3.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[13.5px] font-semibold text-foreground">
            Why {category.name.toLowerCase()} scores {category.score}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {Math.round(category.weight * 100)}% of the overall score · {passed.length} passing ·{" "}
            {deductions.length} to fix · {na.length} not applicable
          </div>
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          {CATEGORY_BY_ID[category.id].blurb}
        </div>
        {deductions.length ? (
          <ul className="mt-3 divide-y divide-border/40">
            {deductions.map((r) => (
              <li key={r.ruleId} className="flex items-start gap-2.5 py-2">
                <StatusGlyph status={r.status} className="mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-foreground/90">
                    {r.title}
                    {r.scope === "page" && r.applicable > 1 && (
                      <span className="text-[11.5px] font-normal text-muted-foreground">
                        {r.failed + r.warned} of {r.applicable} pages
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">
                    {r.detail}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-[12px] font-semibold tabular-nums text-destructive">
                    −{r.pointsLost}
                  </span>
                  <button
                    type="button"
                    onClick={() => onOpenFindings({ ruleId: r.ruleId })}
                    className="text-[11.5px] font-medium text-primary underline-offset-2 hover:underline"
                  >
                    Details
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-3 flex items-center gap-2 text-[12.5px] text-foreground/85">
            <CheckCircle className="h-4 w-4 text-success" /> Every applicable check passes.
          </div>
        )}
        {passed.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              onClick={() => setShowPassed((v) => !v)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showPassed ? "Hide" : "Show"} {passed.length} passing checks
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", showPassed && "rotate-180")}
              />
            </button>
            {showPassed && (
              <ul className="mt-1.5 grid gap-1 sm:grid-cols-2">
                {passed.map((r) => (
                  <li
                    key={r.ruleId}
                    className="flex min-w-0 items-center gap-2 text-[12px] text-foreground/80"
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
      </div>
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
  return (
    <li
      className={cn(
        "rounded-xl border bg-card/60 transition-colors",
        open ? "border-primary/35" : "border-border/60 hover:border-foreground/15",
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-3 sm:flex-nowrap">
        <div className="mt-0.5 shrink-0">
          <PriorityChip priority={action.priority} />
        </div>
        <div className="min-w-0 flex-1 basis-[200px]">
          <div className="break-words text-[13.5px] font-medium text-foreground">
            {action.title}
          </div>
          <div className="mt-0.5 break-words text-[12.5px] leading-relaxed text-muted-foreground">
            {action.detail}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted-foreground">
            {action.pointsLost > 0 && (
              <span className="font-medium text-success">+{action.pointsLost} pts possible</span>
            )}
            {action.affectedPages > 1 && <span>{action.affectedPages} pages</span>}
            <span>Effort: {action.effort}</span>
            <span title={SAFETY_META[action.safety].hint}>{SAFETY_META[action.safety].label}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {recipe && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(open ? ghostBtn : primaryBtn, "px-3 py-1.5 text-[12px]")}
            >
              <Wand className="h-3.5 w-3.5" strokeWidth={2.2} />
              {open ? "Hide fix" : "Show fix"}
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenFindings({ ruleId: action.ruleId })}
            className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
            title="Evidence, affected pages, pull-request fix and verification"
          >
            <Eye className="h-3.5 w-3.5" />{" "}
            {action.affectedPages > 1 ? `${action.affectedPages} pages · Fix this` : "Fix this"}
          </button>
          <button
            type="button"
            onClick={ask}
            className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
            title="Open this issue in chat with Ravi"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={2.2} /> Ask Ravi
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
      <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-[12.5px] text-muted-foreground">
        AI answer checks didn't complete for this scan: {probes.error}
      </div>
    );
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Mentioned", pct(probes.mentionRate)],
          ["Cited", pct(probes.citationRate)],
          ["Answers checked", String(probes.answers)],
          ["Questions", String(probes.queries)],
        ].map(([label, value]) => (
          <div key={label}>
            <div className="text-[11px] text-muted-foreground">{label}</div>
            <div className="text-[18px] font-semibold tabular-nums text-foreground">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[12.5px]">
          <thead className="text-[11px] uppercase tracking-wider text-muted-foreground">
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
                <td className="py-1.5 pr-3 font-medium text-foreground/90">{r.engine}</td>
                <td className="py-1.5 pr-3 text-foreground/80">{r.query.text}</td>
                <td className="py-1.5 pr-3">
                  {r.status === "error" ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <StatusGlyph status={r.mentioned ? "pass" : "fail"} />
                  )}
                </td>
                <td className="py-1.5">
                  {r.status === "error" ? (
                    <span className="text-muted-foreground" title={r.error}>
                      error
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
        Answers vary by user, location and time — treat these as a sample, not a ranking.
      </div>
    </div>
  );
}

export function OverviewTab({
  scan,
  previousScore,
  sparkValues,
  brandName,
  probesAvailable,
  onOpenFindings,
}: {
  scan: GeoScanView;
  previousScore: number | null;
  sparkValues: number[];
  brandName: string | null;
  probesAvailable: boolean;
  onOpenFindings: (filter: { category?: GeoCategoryId; ruleId?: string; fixAll?: boolean }) => void;
}) {
  const report = scan.report!;
  const [openCategory, setOpenCategory] = useState<GeoCategoryId | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const verdict = scoreVerdict(report.overall);
  const delta = previousScore === null ? null : report.overall - previousScore;
  const openCat = useMemo(
    () => report.categories.find((c) => c.id === openCategory) ?? null,
    [report, openCategory],
  );
  const actions = showAll ? report.actions : report.actions.slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Score */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/70 p-4 sm:p-5">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative flex flex-wrap items-center gap-4 sm:gap-6">
          <ScoreRing value={report.overall} />
          <div className="min-w-0 flex-1 basis-[240px]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              AI visibility score
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span
                className={cn(
                  "text-[21px] font-semibold tracking-tight",
                  TONE[scoreTone(report.overall)].text,
                )}
              >
                {verdict.label}
              </span>
              <span className="text-[13px] text-muted-foreground">{verdict.line}</span>
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <a
                href={scan.origin}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-medium text-foreground/85 underline-offset-2 hover:underline"
              >
                {displayUrl(scan.origin)}
              </a>
              <span>
                · {report.counts.pagesCrawled} page{report.counts.pagesCrawled === 1 ? "" : "s"} ·
                scanned {relativeTime(scan.completedAt ?? scan.createdAt)}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip tone="success">{report.counts.passed} passing checks</Chip>
              <Chip tone="warning">{report.counts.warned} to improve</Chip>
              <Chip tone="destructive">{report.counts.failed} failing</Chip>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:flex-col sm:items-end">
            {delta === null ? (
              <span className="text-[12px] text-muted-foreground">First scan of this site</span>
            ) : delta === 0 ? (
              <span className="text-[12px] text-muted-foreground">No change since last scan</span>
            ) : (
              <Chip
                tone={delta > 0 ? "success" : "destructive"}
                className="px-2.5 py-1 text-[12px]"
              >
                {delta > 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                {delta > 0 ? "+" : ""}
                {delta} since last scan
              </Chip>
            )}
            <Sparkline values={sparkValues} />
            <button
              type="button"
              onClick={async () => {
                if (await copyText(buildReport(scan))) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                }
              }}
              className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-success" /> Report copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" /> Copy report
                </>
              )}
            </button>
          </div>
        </div>
        <div className="relative mt-5 grid grid-cols-2 gap-2 min-[560px]:grid-cols-3 lg:grid-cols-6">
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

      {/* Engines */}
      <div>
        <PanelHeading
          icon={Bot}
          title="Can AI engines read your site?"
          hint="From your robots.txt rules"
        />
        <div className="grid grid-cols-2 gap-2 min-[560px]:grid-cols-3 lg:grid-cols-6">
          {report.engines.map((e) => {
            const state = ENGINE_STATE[e.state];
            return (
              <div
                key={e.id}
                className="min-w-0 rounded-xl border border-border/60 bg-card/50 px-3 py-2.5"
                title={`Crawlers: ${e.bots.join(", ")}`}
              >
                <div className="truncate text-[13px] font-medium text-foreground">{e.name}</div>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <Chip tone={state.tone}>{state.label}</Chip>
                  {e.state === "partial" && (
                    <span className="truncate text-[11px] text-muted-foreground">
                      blocks {e.blocked.join(", ")}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Fix next + snapshot */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          <PanelHeading
            icon={Target}
            title="Fix next"
            hint={
              report.actions.length
                ? `${report.actions.length} recommendations, highest impact first`
                : undefined
            }
            action={
              report.actions.length ? (
                <button
                  type="button"
                  onClick={() => onOpenFindings({ fixAll: true })}
                  className={cn(primaryBtn, "px-3 py-1.5 text-[12px]")}
                  title="Every fix Mellox can make, in one GitHub pull request you approve once"
                >
                  <Wand className="h-3.5 w-3.5" strokeWidth={2.2} /> Fix all automatically
                </button>
              ) : undefined
            }
          />
          {report.actions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl border border-success/30 bg-success/5 px-4 py-3.5">
              <CheckCircle className="h-5 w-5 shrink-0 text-success" strokeWidth={2.2} />
              <div className="text-[13px] text-foreground/90">
                No open recommendations — every applicable check passes.
              </div>
            </div>
          ) : (
            <>
              <ul className="space-y-2">
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
                  className={cn(ghostBtn, "mt-2 w-full px-3 py-2 text-[12.5px]")}
                >
                  {showAll
                    ? "Show top 5 only"
                    : `Show all ${report.actions.length} recommendations`}
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", showAll && "rotate-180")}
                  />
                </button>
              )}
            </>
          )}
        </div>
        <div className="min-w-0">
          <PanelHeading icon={Eye} title="What AI engines see" hint="Homepage" />
          <div className="space-y-3 rounded-2xl border border-border/60 bg-card/50 p-4">
            {[
              ["Title", report.snapshot.title],
              ["Description", report.snapshot.description],
            ].map(([label, value]) => (
              <div key={label}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                </div>
                <p className="mt-0.5 line-clamp-3 break-words text-[13px] text-foreground/90">
                  {value?.trim() || <span className="italic text-destructive">Missing</span>}
                </p>
              </div>
            ))}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Schema types
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {report.snapshot.schemaTypes.length ? (
                  report.snapshot.schemaTypes.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11.5px] font-medium text-primary"
                    >
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-[13px] italic text-destructive">Missing</span>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 border-t border-border/50 pt-3">
              {[
                ["Words", report.snapshot.words.toLocaleString()],
                ["Sitemap URLs", report.snapshot.sitemapUrls.toLocaleString()],
                ["llms.txt", report.snapshot.llmsTxt ? "Found" : "Missing"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0">
                  <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
                  <dd
                    className={cn(
                      "text-[14px] font-semibold tabular-nums",
                      value === "Missing" ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* AI answer checks */}
      <div>
        <PanelHeading
          icon={Radio}
          title="AI answer checks"
          hint="Observed answers — separate from the readiness score"
        />
        {scan.probes ? (
          <ProbesPanel probes={scan.probes} />
        ) : scan.probesRequested && scan.stage === "probing" ? (
          <div className="rounded-xl border border-border/60 px-4 py-3 text-[12.5px] text-muted-foreground">
            Pending — asking AI engines now.
          </div>
        ) : scan.probesRequested ? (
          <div className="rounded-xl border border-border/60 px-4 py-3 text-[12.5px] text-muted-foreground">
            Requested for this scan, but no answers were recorded.
          </div>
        ) : probesAvailable ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-[12.5px] text-muted-foreground">
            Not run for this scan. Turn on “Ask AI engines about your brand” for your next full scan
            to see whether AI engines mention and cite {displayUrl(scan.origin)}. Uses AI credits.
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-[12.5px] text-muted-foreground">
            Unavailable in this workspace. AI answer checks are paid model calls and are switched
            off; nothing on this page estimates mentions or citations.
          </div>
        )}
      </div>

      {report.rendering && report.rendering.needed > 0 && (
        <div className="rounded-xl border border-border/60 bg-card/50 px-4 py-3 text-[12.5px]">
          <span className="font-medium">JavaScript rendering: </span>
          {report.rendering.rendered} of {report.rendering.needed} client-rendered page
          {report.rendering.needed === 1 ? "" : "s"} were rendered in a browser for analysis.
          {!report.rendering.available && (
            <span className="text-muted-foreground">
              {" "}
              {report.rendering.reason} Content checks on those pages used the server HTML only.
            </span>
          )}
        </div>
      )}

      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => onOpenFindings({})}
          className={cn(ghostBtn, "px-4 py-2 text-[12.5px]")}
        >
          <ListTree className="h-3.5 w-3.5" /> See all {report.counts.findings} findings
        </button>
      </div>
    </div>
  );
}

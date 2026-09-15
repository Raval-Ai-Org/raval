"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ExternalLink, FileText, Search } from "@/components/icons";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getScanPage, getScanPages } from "@/lib/geo.functions";
import type { GeoPageDetail, GeoPageView, GeoScanView } from "@/lib/geo/contracts";
import { CATEGORY_BY_ID, type GeoCategoryId } from "@/lib/geo/types";
import {
  Chip,
  ghostBtn,
  MiniBar,
  pathOf,
  PriorityChip,
  Segmented,
  StatusGlyph,
  TONE,
  scoreTone,
} from "./geo-ui";

type PageFilter = "all" | "issues" | "errors" | "skipped";

function StatusCell({ page }: { page: GeoPageView }) {
  if (page.state === "skipped") return <Chip tone="muted">Skipped</Chip>;
  if (page.state === "failed") return <Chip tone="destructive">Failed</Chip>;
  if ((page.statusCode ?? 0) >= 400) return <Chip tone="destructive">{page.statusCode}</Chip>;
  return <span className="tabular-nums text-muted-foreground">{page.statusCode ?? "—"}</span>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border/60 bg-gradient-to-b from-card/90 to-card/40 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3.5">
      <h4 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h4>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(90px,150px)_1fr] gap-3 py-1 text-[12.5px]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground/90">
        {value ?? <span className="italic text-destructive">Missing</span>}
      </dd>
    </div>
  );
}

function PageDetailView({
  workspaceId,
  pageId,
  onBack,
}: {
  workspaceId: string;
  pageId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<GeoPageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getScanPage({ data: { workspaceId, pageId } })
      .then((d) => !cancelled && setDetail(d))
      .catch(
        (e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load the page"),
      );
    return () => {
      cancelled = true;
    };
  }, [workspaceId, pageId]);

  const back = (
    <button type="button" onClick={onBack} className={cn(ghostBtn, "px-3 py-1.5 text-[12px]")}>
      <ChevronLeft className="h-3.5 w-3.5" /> All pages
    </button>
  );
  if (error)
    return (
      <div className="space-y-3">
        {back}
        <ErrorState size="sm" detail={error} />
      </div>
    );
  if (!detail)
    return (
      <div className="space-y-3">
        {back}
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );

  const { page, analysis: a, findings } = detail;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {back}
        <a
          href={page.finalUrl ?? page.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-w-0 items-center gap-1 truncate text-[13px] font-medium text-foreground underline-offset-2 hover:underline"
        >
          <span className="truncate">{pathOf(page.url)}</span>{" "}
          <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
        </a>
        {page.score !== null && <Chip tone={scoreTone(page.score)}>Score {page.score}</Chip>}
        {a && <Chip tone="muted">{a.pageType}</Chip>}
      </div>

      {page.score !== null && Object.keys(page.categoryScores).length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {(Object.entries(page.categoryScores) as [GeoCategoryId, number][]).map(([id, score]) => (
            <div
              key={id}
              className="rounded-lg border border-border/60 bg-background/50 px-2.5 py-2"
            >
              <div className="truncate text-[11px] text-muted-foreground">
                {CATEGORY_BY_ID[id]?.short ?? id}
              </div>
              <div
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  TONE[scoreTone(score)].text,
                )}
              >
                {score}
              </div>
              <MiniBar value={score} />
            </div>
          ))}
        </div>
      )}

      {!a ? (
        <EmptyState
          size="sm"
          icon={FileText}
          title="No page evidence"
          description={page.skipReason ?? "This page wasn't analyzed."}
        />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          <Section title="Metadata">
            <dl>
              <Row label="Title" value={a.title} />
              <Row label="Description" value={a.metaDescription} />
              <Row label="Canonical" value={a.canonicals.join(", ") || null} />
              <Row label="Robots" value={a.robotsMeta?.raw || "index, follow (default)"} />
              <Row label="Language" value={a.lang} />
              <Row
                label="HTTP"
                value={`${page.statusCode ?? "—"} · ${page.fetchMs ?? "—"} ms · ${(a.bytes / 1024).toFixed(0)} KB`}
              />
            </dl>
          </Section>
          <Section title="Answer readiness">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "text-[22px] font-semibold tabular-nums",
                  TONE[scoreTone(a.readiness.score * 100)].text,
                )}
              >
                {Math.round(a.readiness.score * 100)}
              </div>
              <div className="text-[12.5px] text-muted-foreground">
                {a.readiness.level} readiness · topic “{a.topic.primary ?? "—"}” ·{" "}
                {a.text.words.toLocaleString()} words
              </div>
            </div>
            <ul className="mt-2 space-y-1 text-[12.5px]">
              {a.readiness.positives.slice(0, 3).map((p) => (
                <li key={p} className="flex gap-2 text-foreground/85">
                  <StatusGlyph status="pass" className="mt-0.5 h-3.5 w-3.5" />
                  {p}
                </li>
              ))}
              {a.readiness.negatives.slice(0, 4).map((n) => (
                <li key={n} className="flex gap-2 text-foreground/85">
                  <StatusGlyph status="warn" className="mt-0.5 h-3.5 w-3.5" />
                  {n}
                </li>
              ))}
            </ul>
          </Section>
          <Section title={`Headings (${a.headings.length})`}>
            {a.headings.length ? (
              <ol className="max-h-56 space-y-0.5 overflow-auto text-[12.5px]">
                {a.headings.slice(0, 40).map((h, i) => (
                  <li
                    key={i}
                    className="truncate text-foreground/85"
                    style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                  >
                    <span className="mr-1.5 font-mono text-[10.5px] text-muted-foreground">
                      H{h.level}
                    </span>
                    {h.text || <span className="italic text-muted-foreground">(empty)</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-[12.5px] italic text-destructive">No headings</p>
            )}
          </Section>
          <Section title="Structured data & entities">
            <dl>
              <Row label="Schema types" value={a.schema.types.join(", ") || null} />
              <Row
                label="Organization"
                value={
                  a.schema.organizations[0]
                    ? `${a.schema.organizations[0].name} · ${a.schema.organizations[0].sameAs.length} sameAs`
                    : null
                }
              />
              <Row label="Author" value={a.trust.byline} />
              <Row label="FAQ entries" value={String(a.schema.faq.length)} />
              <Row
                label="Entities"
                value={
                  a.entities.items
                    .map((e) => e.name)
                    .slice(0, 6)
                    .join(", ") || "—"
                }
              />
            </dl>
          </Section>
          <Section title={`Questions (${a.questions.total})`}>
            {a.questions.items.length ? (
              <ul className="max-h-56 space-y-1 overflow-auto text-[12.5px]">
                {a.questions.items.slice(0, 20).map((q, i) => (
                  <li key={i} className="flex gap-2">
                    <StatusGlyph
                      status={q.answered ? (q.direct ? "pass" : "warn") : "fail"}
                      className="mt-0.5 h-3.5 w-3.5"
                    />
                    <span className="text-foreground/85">{q.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12.5px] text-muted-foreground">No questions on this page.</p>
            )}
          </Section>
          <Section title="Links, sources & claims">
            <dl>
              <Row
                label="Links"
                value={`${a.links.internal.length} internal · ${a.links.external.length} external`}
              />
              <Row
                label="Sources cited"
                value={`${a.sources.citationCandidates} (${a.sources.primary} primary)`}
              />
              <Row
                label="Statistics"
                value={`${a.claims.statistical} · ${a.claims.statisticalUnsupported} without a source`}
              />
              <Row
                label="Images"
                value={`${a.images.total} · ${a.images.missingAlt} missing alt`}
              />
            </dl>
          </Section>
        </div>
      )}

      <Section title={`Findings on this page (${findings.length})`}>
        {findings.length ? (
          <ul className="divide-y divide-border/40">
            {findings.map((f) => (
              <li key={f.id} className="flex items-start gap-2.5 py-2">
                <PriorityChip priority={f.priority} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-foreground/90">{f.title}</div>
                  <div className="text-[12.5px] text-muted-foreground">{f.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[12.5px] text-muted-foreground">
            No findings — this page passes every applicable check.
          </p>
        )}
      </Section>
    </div>
  );
}

export function PagesTab({ workspaceId, scan }: { workspaceId: string; scan: GeoScanView }) {
  const [pages, setPages] = useState<GeoPageView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [filter, setFilter] = useState<PageFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPages(null);
    setSelected(null);
    getScanPages({ data: { workspaceId, scanId: scan.id } })
      .then((rows) => !cancelled && setPages(rows))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Couldn't load pages"));
    return () => {
      cancelled = true;
    };
  }, [workspaceId, scan.id, nonce]);

  const visible = useMemo(() => {
    if (!pages) return [];
    const q = query.trim().toLowerCase();
    return pages
      .filter((p) =>
        filter === "issues"
          ? p.issues > 0
          : filter === "errors"
            ? p.state === "failed" || (p.statusCode ?? 0) >= 400
            : filter === "skipped"
              ? p.state === "skipped"
              : true,
      )
      .filter((p) => !q || `${p.url} ${p.title ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => (a.score ?? 101) - (b.score ?? 101));
  }, [pages, filter, query]);

  if (selected)
    return (
      <PageDetailView
        workspaceId={workspaceId}
        pageId={selected}
        onBack={() => setSelected(null)}
      />
    );
  if (error)
    return (
      <ErrorState
        size="sm"
        detail={error}
        onRetry={() => {
          setError(null);
          setNonce((n) => n + 1);
        }}
      />
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Filter pages"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: `All${pages ? ` (${pages.length})` : ""}` },
            { value: "issues", label: "With issues" },
            { value: "errors", label: "Errors" },
            { value: "skipped", label: "Skipped" },
          ]}
        />
        <label className="relative ml-auto flex items-center">
          <span className="sr-only">Search pages</span>
          <Search className="pointer-events-none absolute z-10 left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search URL or title"
            className="h-8 w-52 rounded-full border border-border/70 bg-background/60 pl-8 pr-3 text-[12.5px] outline-none focus-visible:ring-2 focus-visible:ring-primary/25"
          />
        </label>
      </div>
      {!pages ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : visible.length === 0 ? (
        <EmptyState
          size="sm"
          icon={FileText}
          title="No pages match"
          description="Try another filter."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[640px] text-left text-[12.5px]">
            <thead className="bg-card/70 text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Page</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">HTTP</th>
                <th className="px-3 py-2 font-medium">Issues</th>
                <th className="w-32 px-3 py-2 font-medium">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {visible.slice(0, 500).map((p) => (
                <tr
                  key={p.id}
                  tabIndex={p.state === "fetched" ? 0 : -1}
                  onClick={() => p.state === "fetched" && setSelected(p.id)}
                  onKeyDown={(e) => e.key === "Enter" && p.state === "fetched" && setSelected(p.id)}
                  className={cn(
                    p.state === "fetched" &&
                      "cursor-pointer hover:bg-secondary/40 focus-visible:bg-secondary/40 focus-visible:outline-none",
                  )}
                >
                  <td className="max-w-[340px] px-3 py-2">
                    <div className="truncate font-medium text-foreground/90">{pathOf(p.url)}</div>
                    <div className="truncate text-[11.5px] text-muted-foreground">
                      {p.title ?? p.skipReason ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{p.pageType ?? "—"}</td>
                  <td className="px-3 py-2">
                    <StatusCell page={p} />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{p.issues || "—"}</td>
                  <td className="px-3 py-2">
                    {p.score === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "w-7 font-semibold tabular-nums",
                            TONE[scoreTone(p.score)].text,
                          )}
                        >
                          {p.score}
                        </span>
                        <div className="flex-1">
                          <MiniBar value={p.score} />
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

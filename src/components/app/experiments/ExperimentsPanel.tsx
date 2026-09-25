"use client";

// Experiments (Proof Engine, ADR-0024).
//
// One rail, three pages: Tests (every experiment and its result), Pages (groups
// of similar pages Mellox can test, and their one-time setup) and Report
// (the name and logo on client reports). Opening a test shows its detail:
// the exact pull request to approve, the live progress, and the result.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LayoutDashboard,
  List,
  Pencil,
  RefreshCw,
  Settings,
  ShieldCheck,
  Trophy,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { emitAppEvent } from "@/lib/app-events";
import { useServerFn } from "@/lib/use-server-fn";
import { relativeTime } from "@/components/app/geo/geo-ui";
import {
  GroupLabel,
  Stat,
  SurfaceLayout,
  SurfacePage,
  Tile,
  type SurfaceNavItem,
} from "@/components/app/surface/SurfaceLayout";
import { btnGhost, btnPrimary, btnQuiet, inputBase } from "@/components/app/links/links-ui";
import {
  CHANGE_TYPE_LABELS,
  METRIC_LABELS,
  STATUS_LABELS,
  type ChangeType,
  type DeliveryView,
  type ExperimentDetail,
  type ExperimentMetric,
  type ExperimentSummary,
  type ExperimentsOverview,
  type HypothesisView,
  type PageGroupView,
} from "@/lib/experiments/contracts";
import * as fns from "@/lib/experiments.functions";
import { formatLift, formatMoney, ResultChart } from "./ExperimentReport";

type Tab = "tests" | "pages" | "report";
type View = { kind: "list" } | { kind: "detail"; id: string } | { kind: "new"; groupId: string };

const MOVING = [
  "draft",
  "awaiting_approval",
  "shipping",
  "awaiting_deploy",
  "running",
  "analyzing",
  "rolling_out",
  "rolling_back",
];
const METRIC_CHOICES: ExperimentMetric[] = [
  "clicks",
  "ctr",
  "impressions",
  "sessions",
  "key_events",
  "revenue",
  "ai_referral_sessions",
];

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async <T,>(key: string, fn: () => Promise<T>, done?: string): Promise<T | null> => {
    setBusy(key);
    try {
      const out = await fn();
      if (done) toast.success(done);
      return out;
    } catch (e) {
      toast.error(errorText(e));
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}

export function ExperimentsPanel({ workspaceId }: { workspaceId: string }) {
  const [tab, setTab] = useState<Tab>("tests");
  const [view, setView] = useState<View>({ kind: "list" });
  const getOverview = useServerFn(fns.getExperimentsOverview);
  const overview = useQuery({
    queryKey: ["experiments", workspaceId, "overview"],
    queryFn: () => getOverview({ data: { workspaceId } }),
    refetchInterval: (q) =>
      (q.state.data as ExperimentsOverview | undefined)?.experiments.some((e) =>
        MOVING.includes(e.status),
      )
        ? 20_000
        : false,
  });

  const items: SurfaceNavItem<Tab>[] = [
    {
      id: "tests",
      label: "Tests",
      icon: LayoutDashboard,
      count: overview.data?.experiments.length,
    },
    { id: "pages", label: "Pages", icon: List, count: overview.data?.groups.length },
    { id: "report", label: "Client report", icon: Settings },
  ];

  const go = (t: Tab) => {
    setTab(t);
    setView({ kind: "list" });
  };

  return (
    <SurfaceLayout
      label="Experiments"
      items={items}
      value={view.kind === "list" ? tab : null}
      onChange={go}
      railTop={
        overview.data?.provenMonthlyValue ? (
          <div className="rounded-xl border border-border/60 p-3">
            <p className="text-[11px] text-muted-foreground">Proven so far</p>
            <p className="text-[15px] font-semibold">
              {formatMoney(overview.data.provenMonthlyValue, overview.data.provenCurrency)} / month
            </p>
          </div>
        ) : null
      }
    >
      {overview.isLoading ? (
        <SurfacePage>
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </SurfacePage>
      ) : overview.error ? (
        <SurfacePage>
          <ErrorState detail={errorText(overview.error)} onRetry={() => overview.refetch()} />
        </SurfacePage>
      ) : !overview.data ? null : view.kind === "detail" ? (
        <ExperimentDetailView
          workspaceId={workspaceId}
          id={view.id}
          onBack={() => setView({ kind: "list" })}
        />
      ) : view.kind === "new" ? (
        <NewExperiment
          workspaceId={workspaceId}
          overview={overview.data}
          groupId={view.groupId}
          onBack={() => setView({ kind: "list" })}
          onCreated={(id) => setView({ kind: "detail", id })}
        />
      ) : tab === "tests" ? (
        <TestsPage
          data={overview.data}
          onOpen={(id) => setView({ kind: "detail", id })}
          onPages={() => setTab("pages")}
        />
      ) : tab === "pages" ? (
        <PagesPage
          workspaceId={workspaceId}
          data={overview.data}
          onStart={(groupId) => setView({ kind: "new", groupId })}
        />
      ) : (
        <BrandingPage workspaceId={workspaceId} data={overview.data} />
      )}
    </SurfaceLayout>
  );
}

/* ───────────────────────── setup ───────────────────────── */

function SetupBlockers({ data }: { data: ExperimentsOverview }) {
  if (!data.setup.blockers.length) return null;
  return (
    <Tile className="space-y-3">
      <p className="text-[14px] font-medium">Before you can test</p>
      <ul className="space-y-2">
        {data.setup.blockers.map((b) => (
          <li key={b.code} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span>{b.message}</span>
            {b.action !== "none" && (
              <button
                type="button"
                className={btnGhost}
                onClick={() =>
                  emitAppEvent("open:settings", {
                    section: b.action === "connect_google" ? "analytics" : "website",
                  })
                }
              >
                {b.action === "connect_google"
                  ? "Connect Google"
                  : b.action === "connect_github"
                    ? "Connect GitHub"
                    : "Verify"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/* ───────────────────────── tests ───────────────────────── */

function StatusText({ e }: { e: ExperimentSummary }) {
  if (e.status === "running" || e.status === "analyzing") {
    return (
      <span>
        Day {e.daysLive ?? 0}
        {e.earlyLift !== null ? ` · early read ${formatLift(e.earlyLift)}` : ""}
      </span>
    );
  }
  if (e.verdict) {
    const label =
      e.verdict === "win" ? "Helped" : e.verdict === "loss" ? "Hurt" : "No clear difference";
    return (
      <span>
        {label} {e.lift !== null ? `(${formatLift(e.lift)})` : ""}
      </span>
    );
  }
  return <span>{STATUS_LABELS[e.status]}</span>;
}

function TestsPage({
  data,
  onOpen,
  onPages,
}: {
  data: ExperimentsOverview;
  onOpen: (id: string) => void;
  onPages: () => void;
}) {
  const active = data.experiments.filter(
    (e) => !["closed", "cancelled", "invalidated"].includes(e.status),
  );
  const done = data.experiments.filter((e) =>
    ["closed", "cancelled", "invalidated"].includes(e.status),
  );
  return (
    <SurfacePage
      title="Tests"
      subtitle={`${data.limit.used} of ${data.limit.max} running at once on your plan`}
      actions={
        data.canEdit && (
          <button type="button" className={btnPrimary} onClick={onPages}>
            New test
          </button>
        )
      }
    >
      <div className="space-y-4">
        <SetupBlockers data={data} />
        {!data.experiments.length ? (
          <EmptyState
            icon={Trophy}
            title="No tests yet"
            description="Change half of a group of similar pages and see if it really helps."
            action={
              data.canEdit && (
                <button type="button" className={btnPrimary} onClick={onPages}>
                  Pick pages to test
                </button>
              )
            }
          />
        ) : (
          <>
            {active.length > 0 && (
              <ExperimentList title="In progress" items={active} onOpen={onOpen} />
            )}
            {done.length > 0 && <ExperimentList title="Finished" items={done} onOpen={onOpen} />}
          </>
        )}
      </div>
    </SurfacePage>
  );
}

function ExperimentList({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ExperimentSummary[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <GroupLabel>{title}</GroupLabel>
      {items.map((e) => (
        <Tile
          key={e.id}
          interactive
          as="article"
          className="cursor-pointer"
          onClick={() => onOpen(e.id)}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[14.5px] font-medium">{e.name}</p>
              <p className="text-[12.5px] text-muted-foreground">
                {CHANGE_TYPE_LABELS[e.changeType]} · {METRIC_LABELS[e.primaryMetric]}
                {e.groupLabel ? ` · ${e.groupLabel}` : ""}
              </p>
            </div>
            <div className="shrink-0 text-right text-[12.5px]">
              <StatusText e={e} />
              {e.estimatedMonthlyValue !== null && (
                <p className="text-muted-foreground">
                  {formatMoney(e.estimatedMonthlyValue, e.valueCurrency)} / month
                </p>
              )}
            </div>
          </div>
        </Tile>
      ))}
    </div>
  );
}

/* ───────────────────────── pages (groups) ───────────────────────── */

function PagesPage({
  workspaceId,
  data,
  onStart,
}: {
  workspaceId: string;
  data: ExperimentsOverview;
  onStart: (groupId: string) => void;
}) {
  const qc = useQueryClient();
  const detect = useServerFn(fns.detectPageGroups);
  const { busy, run } = useAction();
  const [setup, setSetup] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["experiments", workspaceId] });
  const ready = !data.setup.blockers.length;

  return (
    <SurfacePage
      title="Pages you can test"
      subtitle="Groups of similar pages built by the same template in your code."
      actions={
        data.canEdit && ready ? (
          <button
            type="button"
            className={btnGhost}
            disabled={busy === "detect"}
            onClick={async () => {
              const out = await run("detect", () => detect({ data: { workspaceId } }));
              if (out) {
                toast.success(
                  `Found ${out.groups.length} group${out.groups.length === 1 ? "" : "s"}.`,
                );
                refresh();
              }
            }}
          >
            <RefreshCw className={cn("h-4 w-4", busy === "detect" && "animate-spin")} />
            {data.groups.length ? "Look again" : "Find pages"}
          </button>
        ) : null
      }
    >
      <div className="space-y-3">
        <SetupBlockers data={data} />
        {!data.groups.length ? (
          <EmptyState
            icon={List}
            title="No page groups yet"
            description={
              ready
                ? "Mellox looks at your Search Console pages and finds groups of similar ones."
                : "Finish the steps above first."
            }
          />
        ) : (
          data.groups.map((g) => (
            <GroupCard
              key={g.id}
              group={g}
              canEdit={data.canEdit}
              onSetup={() => setSetup(g.id)}
              onStart={() => onStart(g.id)}
            />
          ))
        )}
        {setup && (
          <SetupReview
            workspaceId={workspaceId}
            group={data.groups.find((g) => g.id === setup)!}
            onClose={() => {
              setSetup(null);
              refresh();
            }}
          />
        )}
      </div>
    </SurfacePage>
  );
}

function GroupCard({
  group,
  canEdit,
  onSetup,
  onStart,
}: {
  group: PageGroupView;
  canEdit: boolean;
  onSetup: () => void;
  onStart: () => void;
}) {
  const i = group.integration;
  return (
    <Tile className="space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14.5px] font-medium">{group.label}</p>
          <p className="text-[12.5px] text-muted-foreground">
            {group.pattern} · {group.pageCount} pages · about {group.monthlyClicks.toLocaleString()}{" "}
            clicks a month
            {group.busyPages ? ` · ${group.busyPages} already in a test` : ""}
          </p>
          {group.templateFile && (
            <p className="text-[12px] text-muted-foreground">Built by {group.templateFile}</p>
          )}
        </div>
        <div className="shrink-0">
          {i.state === "ready" ? (
            canEdit && (
              <button type="button" className={btnPrimary} onClick={onStart}>
                Start a test
              </button>
            )
          ) : i.state === "pending" ? (
            i.prUrl ? (
              <a className={btnGhost} href={i.prUrl} target="_blank" rel="noreferrer">
                {i.status === "merged" ? "Checking setup…" : "Merge setup PR"}
              </a>
            ) : (
              canEdit && (
                <button type="button" className={btnGhost} onClick={onSetup}>
                  Review setup
                </button>
              )
            )
          ) : (
            canEdit &&
            group.templateFile && (
              <button type="button" className={btnGhost} onClick={onSetup}>
                Set up
              </button>
            )
          )}
        </div>
      </div>
      {i.state === "none" && i.reason && (
        <p className="text-[12.5px] text-muted-foreground">{i.reason}</p>
      )}
      {i.state === "ready" && (
        <p className="text-[12.5px] text-muted-foreground">
          Can test: {i.fields.map((f) => CHANGE_TYPE_LABELS[f]).join(", ")}
        </p>
      )}
    </Tile>
  );
}

/** One-time setup: prepare (or open) the integration pull request and approve it. */
function SetupReview({
  workspaceId,
  group,
  onClose,
}: {
  workspaceId: string;
  group: PageGroupView;
  onClose: () => void;
}) {
  const prepare = useServerFn(fns.prepareGroupSetup);
  const getDelivery = useServerFn(fns.getDelivery);
  const approve = useServerFn(fns.approveGroupSetup);
  const discard = useServerFn(fns.discardDelivery);
  const { busy, run } = useAction();
  const pendingId = group.integration.state === "pending" ? group.integration.deliveryId : null;
  const [deliveryId, setDeliveryId] = useState<string | null>(pendingId);
  const delivery = useQuery({
    queryKey: ["experiments", workspaceId, "delivery", deliveryId],
    queryFn: () => getDelivery({ data: { workspaceId, deliveryId: deliveryId! } }),
    enabled: !!deliveryId,
  });

  return (
    <Tile className="space-y-3 border-[var(--ds-accent,#9ACD32)]/40">
      <div className="flex items-center justify-between">
        <p className="text-[14px] font-medium">Set up “{group.label}”</p>
        <button type="button" className={btnQuiet} onClick={onClose}>
          Close
        </button>
      </div>
      <p className="text-[13px] text-muted-foreground">
        Mellox adds a small file to your code so these pages can show a test value. Until a test is
        approved, nothing on your site changes. You review and merge the pull request yourself.
      </p>
      {!deliveryId ? (
        <button
          type="button"
          className={btnPrimary}
          disabled={busy === "prepare"}
          onClick={async () => {
            const out = await run("prepare", () =>
              prepare({ data: { workspaceId, groupId: group.id } }),
            );
            if (out) setDeliveryId(out.deliveryId);
          }}
        >
          {busy === "prepare" ? "Preparing the change…" : "Prepare the change"}
        </button>
      ) : delivery.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : delivery.error ? (
        <ErrorState
          size="sm"
          detail={errorText(delivery.error)}
          onRetry={() => delivery.refetch()}
        />
      ) : delivery.data ? (
        <DeliveryReview
          delivery={delivery.data}
          busy={busy}
          approveLabel="Approve and open pull request"
          onApprove={async () => {
            const out = await run(
              "approve",
              () =>
                approve({
                  data: {
                    workspaceId,
                    deliveryId: delivery.data!.id,
                    contentHash: delivery.data!.contentHash!,
                  },
                }),
              "Pull request opened.",
            );
            if (out?.prUrl) window.open(out.prUrl, "_blank", "noopener");
            if (out) onClose();
          }}
          onDiscard={async () => {
            const ok = await run("discard", () =>
              discard({ data: { workspaceId, deliveryId: delivery.data!.id } }),
            );
            if (ok) onClose();
          }}
        />
      ) : null}
    </Tile>
  );
}

/** The exact files a pull request will contain, and the approve button bound to their hash. */
function DeliveryReview({
  delivery,
  busy,
  approveLabel,
  onApprove,
  onDiscard,
}: {
  delivery: DeliveryView;
  busy: string | null;
  approveLabel: string;
  onApprove?: () => void;
  onDiscard?: () => void;
}) {
  const [open, setOpen] = useState<string | null>(delivery.files[0]?.path ?? null);
  const blocked = delivery.problems.length > 0;
  return (
    <div className="space-y-3">
      {delivery.explanation && <p className="text-[13px]">{delivery.explanation}</p>}
      {delivery.problems.length > 0 && (
        <ul className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[13px] text-red-700 dark:text-red-300 space-y-1">
          {delivery.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {delivery.error && <p className="text-[13px] text-red-600">{delivery.error}</p>}
      <div className="space-y-2">
        {delivery.files.map((f) => (
          <div key={f.path} className="rounded-xl border border-border/60">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px]"
              onClick={() => setOpen(open === f.path ? null : f.path)}
            >
              <span className="font-mono">{f.path}</span>
              <span className="text-muted-foreground">
                {f.action === "create" ? "New file" : "Changed"}
              </span>
            </button>
            {open === f.path && (
              <pre className="max-h-80 overflow-auto border-t border-border/60 px-3 py-2 text-[11.5px] leading-relaxed">
                {f.diff
                  .split("\n")
                  .slice(4)
                  .map((line, i) => (
                    <span
                      key={i}
                      className={cn(
                        "block",
                        line.startsWith("+") &&
                          "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        line.startsWith("-") && "bg-red-500/10 text-red-700 dark:text-red-300",
                      )}
                    >
                      {line || " "}
                    </span>
                  ))}
              </pre>
            )}
          </div>
        ))}
      </div>
      {delivery.status === "draft" && (onApprove || onDiscard) && (
        <div className="flex flex-wrap gap-2">
          {onApprove && (
            <button
              type="button"
              className={btnPrimary}
              disabled={blocked || busy === "approve"}
              onClick={onApprove}
            >
              <ShieldCheck className="h-4 w-4" />
              {busy === "approve" ? "Opening pull request…" : approveLabel}
            </button>
          )}
          {onDiscard && (
            <button
              type="button"
              className={btnGhost}
              disabled={busy === "discard"}
              onClick={onDiscard}
            >
              Discard
            </button>
          )}
        </div>
      )}
      {delivery.prUrl && (
        <a className={btnQuiet} href={delivery.prUrl} target="_blank" rel="noreferrer">
          Pull request #{delivery.prNumber} on GitHub
        </a>
      )}
    </div>
  );
}

/* ───────────────────────── new test ───────────────────────── */

function NewExperiment({
  workspaceId,
  overview,
  groupId,
  onBack,
  onCreated,
}: {
  workspaceId: string;
  overview: ExperimentsOverview;
  groupId: string;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const group = overview.groups.find((g) => g.id === groupId);
  const fields = group?.integration.state === "ready" ? group.integration.fields : [];
  const [metric, setMetric] = useState<ExperimentMetric>("clicks");
  const [changeType, setChangeType] = useState<ChangeType | null>(fields[0] ?? null);
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [ideas, setIdeas] = useState<HypothesisView[] | null>(null);
  const checkEligibility = useServerFn(fns.checkGroupEligibility);
  const suggest = useServerFn(fns.suggestHypotheses);
  const create = useServerFn(fns.createExperiment);
  const { busy, run } = useAction();
  const metrics = METRIC_CHOICES.filter(
    (m) => overview.setup.ga4.connected || ["clicks", "ctr", "impressions"].includes(m),
  );

  const eligibility = useQuery({
    queryKey: ["experiments", workspaceId, "eligibility", groupId, metric],
    queryFn: () => checkEligibility({ data: { workspaceId, groupId, metric } }),
    enabled: !!group,
    staleTime: 10 * 60_000,
  });

  if (!group) {
    return (
      <SurfacePage title="New test">
        <EmptyState
          title="That page group is gone"
          action={
            <button className={btnGhost} onClick={onBack}>
              Back
            </button>
          }
        />
      </SurfacePage>
    );
  }

  const e = eligibility.data;
  const mde = e?.mde?.["28"];
  const canCreate =
    !!e?.eligible && !!changeType && name.trim().length >= 3 && hypothesis.trim().length >= 10;

  return (
    <SurfacePage
      title="New test"
      subtitle={`${group.label} · ${group.pageCount} pages`}
      width="narrow"
      actions={
        <button type="button" className={btnQuiet} onClick={onBack}>
          Back
        </button>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[13.5px] font-medium">What should get better?</p>
          <div className="flex flex-wrap gap-2">
            {metrics.map((m) => (
              <button
                key={m}
                type="button"
                className={cn(btnGhost, metric === m && "border-foreground/40 bg-secondary")}
                onClick={() => setMetric(m)}
              >
                {METRIC_LABELS[m]}
              </button>
            ))}
          </div>
          {eligibility.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : eligibility.error ? (
            <p className="text-[13px] text-red-600">{errorText(eligibility.error)}</p>
          ) : e ? (
            e.eligible ? (
              <p className="text-[13px] text-muted-foreground">
                {e.pagesWithData} pages have enough data.
                {mde ? ` A test can spot a change of about ${Math.round(mde * 100)}% or more.` : ""}
              </p>
            ) : (
              <ul className="text-[13px] text-amber-700 dark:text-amber-300 space-y-1">
                {e.reasons.map((r) => (
                  <li key={r.code}>{r.message}</li>
                ))}
              </ul>
            )
          ) : null}
        </div>

        <div className="space-y-2">
          <p className="text-[13.5px] font-medium">What to change</p>
          <div className="flex flex-wrap gap-2">
            {fields.map((f) => (
              <button
                key={f}
                type="button"
                className={cn(btnGhost, changeType === f && "border-foreground/40 bg-secondary")}
                onClick={() => setChangeType(f)}
              >
                {CHANGE_TYPE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[13.5px] font-medium">Your idea</p>
            <button
              type="button"
              className={btnQuiet}
              disabled={busy === "suggest"}
              onClick={async () => {
                const out = await run("suggest", () =>
                  suggest({ data: { workspaceId, groupId, metric } }),
                );
                if (out) setIdeas(out);
              }}
            >
              {busy === "suggest" ? "Thinking…" : "Suggest ideas"}
            </button>
          </div>
          {ideas && ideas.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No ideas this time. Write your own below.
            </p>
          )}
          {ideas?.map((h) => (
            <button
              key={h.title}
              type="button"
              className="w-full rounded-xl border border-border/60 p-3 text-left hover:bg-secondary/60"
              onClick={() => {
                setName(h.title);
                setHypothesis(h.hypothesis);
                if (fields.includes(h.changeType)) setChangeType(h.changeType);
              }}
            >
              <p className="text-[13.5px] font-medium">{h.title}</p>
              <p className="text-[12.5px]">{h.hypothesis}</p>
              <p className="text-[12px] text-muted-foreground">{h.why}</p>
            </button>
          ))}
          <input
            className={inputBase}
            placeholder="Name, e.g. Price in product titles"
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            maxLength={160}
          />
          <textarea
            className={cn(inputBase, "min-h-[90px]")}
            placeholder="Changing … will increase … because …"
            value={hypothesis}
            onChange={(ev) => setHypothesis(ev.target.value)}
            maxLength={2000}
          />
        </div>

        <button
          type="button"
          className={btnPrimary}
          disabled={!canCreate || busy === "create"}
          onClick={async () => {
            const out = await run("create", () =>
              create({
                data: { workspaceId, groupId, metric, changeType: changeType!, name, hypothesis },
              }),
            );
            if (out) onCreated(out.id);
          }}
        >
          {busy === "create" ? "Creating…" : "Create draft"}
        </button>
        <p className="text-[12.5px] text-muted-foreground">
          Mellox splits the pages into two similar halves and writes the new copy for one half. You
          review everything before any code changes.
        </p>
      </div>
    </SurfacePage>
  );
}

/* ───────────────────────── detail ───────────────────────── */

function ExperimentDetailView({
  workspaceId,
  id,
  onBack,
}: {
  workspaceId: string;
  id: string;
  onBack: () => void;
}) {
  const qc = useQueryClient();
  const get = useServerFn(fns.getExperiment);
  const detail = useQuery({
    queryKey: ["experiments", workspaceId, "detail", id],
    queryFn: () => get({ data: { workspaceId, experimentId: id } }),
    refetchInterval: (q) => {
      const d = q.state.data as ExperimentDetail | undefined;
      return d && MOVING.includes(d.status) ? 10_000 : false;
    },
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["experiments", workspaceId] });

  if (detail.isLoading) {
    return (
      <SurfacePage>
        <Skeleton className="h-40 w-full" />
      </SurfacePage>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <SurfacePage>
        <ErrorState detail={errorText(detail.error)} onRetry={() => detail.refetch()} />
      </SurfacePage>
    );
  }
  const d = detail.data;
  return (
    <SurfacePage
      title={d.name}
      subtitle={`${STATUS_LABELS[d.status]} · ${CHANGE_TYPE_LABELS[d.changeType]} · ${METRIC_LABELS[d.primaryMetric]}`}
      actions={
        <button type="button" className={btnQuiet} onClick={onBack}>
          All tests
        </button>
      }
    >
      <div className="space-y-5">
        <p className="text-[14px] text-muted-foreground">{d.hypothesis}</p>
        {d.invalidReason && (
          <Tile className="border-amber-500/40 text-[13.5px]">
            This test was stopped: {d.invalidReason}
          </Tile>
        )}
        <DetailStage workspaceId={workspaceId} d={d} onChanged={refresh} onGone={onBack} />
        {d.result && <ResultSection d={d} />}
        <PairsSection workspaceId={workspaceId} d={d} onChanged={refresh} />
        {d.events.length > 0 && (
          <div className="space-y-2">
            <GroupLabel>History</GroupLabel>
            <ul className="space-y-1.5 text-[13px]">
              {d.events.slice(0, 20).map((ev) => (
                <li key={ev.id} className="flex gap-3">
                  <span className="w-20 shrink-0 text-muted-foreground">
                    {relativeTime(ev.createdAt)}
                  </span>
                  <span>{ev.summary}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SurfacePage>
  );
}

/** What happens next, and the buttons for it. */
function DetailStage({
  workspaceId,
  d,
  onChanged,
  onGone,
}: {
  workspaceId: string;
  d: ExperimentDetail;
  onChanged: () => void;
  onGone: () => void;
}) {
  const { busy, run } = useAction();
  const approve = useServerFn(fns.approveExperiment);
  const discard = useServerFn(fns.discardExperiment);
  const cancel = useServerFn(fns.cancelExperiment);
  const stop = useServerFn(fns.stopExperiment);
  const retry = useServerFn(fns.retryPrepare);
  const refreshShip = useServerFn(fns.refreshShip);
  const prepareDecision = useServerFn(fns.prepareDecision);
  const approveDecision = useServerFn(fns.approveDecision);
  const keep = useServerFn(fns.keepExperiment);
  const close = useServerFn(fns.closeExperiment);
  const ids = { workspaceId, experimentId: d.id };

  const ship = d.deliveries.find((x) => x.kind === "ship" && x.status !== "discarded");
  const decision = d.deliveries.find(
    (x) => (x.kind === "rollout" || x.kind === "rollback") && x.status === "draft",
  );
  const openPr = d.deliveries.find((x) => x.status === "pr_open" || x.status === "merged");

  if (d.status === "draft") {
    if (!ship || d.prepare?.state !== "ready") {
      const failed = d.prepare?.state === "failed";
      return (
        <Tile className="space-y-2">
          {failed ? (
            <>
              <p className="text-[13.5px] text-red-600">
                {d.prepare?.error ?? "Preparing this test failed."}
              </p>
              {d.canEdit && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={busy === "retry"}
                    onClick={() => run("retry", () => retry({ data: ids })).then(onChanged)}
                  >
                    Try again
                  </button>
                  <button
                    type="button"
                    className={btnQuiet}
                    onClick={() =>
                      run("discard", () => discard({ data: ids })).then((ok) => ok && onGone())
                    }
                  >
                    Delete draft
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-[13.5px]">
              Reading your pages and writing the new copy. This takes a minute or two.
            </p>
          )}
        </Tile>
      );
    }
    return (
      <Tile className="space-y-3">
        <p className="text-[14px] font-medium">Review and approve</p>
        <p className="text-[13px] text-muted-foreground">
          This pull request changes only the test pages. Check the copy below, then approve. You
          merge it yourself; the test starts once Mellox sees the change live.
        </p>
        <DeliveryReview
          delivery={ship}
          busy={busy}
          approveLabel="Approve and open pull request"
          onApprove={
            d.actions.approve
              ? () =>
                  run(
                    "approve",
                    () =>
                      approve({
                        data: { ...ids, deliveryId: ship.id, contentHash: ship.contentHash! },
                      }),
                    "Pull request opened.",
                  ).then(onChanged)
              : undefined
          }
          onDiscard={
            d.actions.discard
              ? () => run("discard", () => discard({ data: ids })).then((ok) => ok && onGone())
              : undefined
          }
        />
        {ship.status !== "draft" && d.canEdit && (
          <button
            type="button"
            className={btnGhost}
            onClick={() => run("refresh", () => refreshShip({ data: ids })).then(onChanged)}
          >
            Prepare again
          </button>
        )}
      </Tile>
    );
  }

  if (d.status === "awaiting_approval" && ship && ship.status !== "draft" && d.canEdit) {
    return (
      <Tile className="space-y-2">
        <p className="text-[13.5px]">{ship.error ?? "The pull request couldn't be opened."}</p>
        <button
          type="button"
          className={btnGhost}
          onClick={() => run("refresh", () => refreshShip({ data: ids })).then(onChanged)}
        >
          Prepare again
        </button>
      </Tile>
    );
  }

  if (["shipping", "awaiting_deploy", "rolling_out", "rolling_back"].includes(d.status)) {
    const merged = openPr?.status === "merged";
    return (
      <Tile className="space-y-2">
        <p className="text-[13.5px]">
          {merged
            ? "Merged. Waiting to see the change on your live site."
            : "Waiting for you to merge the pull request."}
        </p>
        {openPr?.prUrl && (
          <a className={btnGhost} href={openPr.prUrl} target="_blank" rel="noreferrer">
            Open pull request #{openPr.prNumber}
          </a>
        )}
        {d.actions.cancel && (
          <button
            type="button"
            className={btnQuiet}
            onClick={() => run("cancel", () => cancel({ data: ids }), "Cancelled.").then(onChanged)}
          >
            Cancel test
          </button>
        )}
      </Tile>
    );
  }

  if (d.status === "running" || d.status === "analyzing") {
    const r = d.result;
    return (
      <Tile className="space-y-2">
        <p className="text-[13.5px]">
          Running for {d.daysLive ?? 0} days.
          {r?.nextCheckpoint
            ? ` First result on day ${r.nextCheckpoint}; Mellox checks again every week after that.`
            : ""}
        </p>
        {d.canEdit && (
          <button
            type="button"
            className={btnQuiet}
            onClick={() => {
              const reason = window.prompt("Why stop this test? (optional)") ?? null;
              if (reason === null) return;
              void run("stop", () => stop({ data: { ...ids, reason } }), "Stopped.").then(
                onChanged,
              );
            }}
          >
            Stop test
          </button>
        )}
      </Tile>
    );
  }

  if (d.status === "concluded" || d.status === "invalidated") {
    return (
      <Tile className="space-y-3">
        <p className="text-[14px] font-medium">
          {d.verdict === "win"
            ? "It helped. Roll it out to every page in the group?"
            : d.verdict === "loss"
              ? "It hurt. Roll it back?"
              : d.verdict
                ? "No clear difference. Keep it or roll it back."
                : "Roll back the test copy, or close the test."}
        </p>
        {decision ? (
          <DeliveryReview
            delivery={decision}
            busy={busy}
            approveLabel={decision.kind === "rollout" ? "Approve roll-out" : "Approve roll-back"}
            onApprove={() =>
              run(
                "approve",
                () =>
                  approveDecision({
                    data: { ...ids, deliveryId: decision.id, contentHash: decision.contentHash! },
                  }),
                "Pull request opened.",
              ).then(onChanged)
            }
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {d.actions.rollout && (
              <button
                type="button"
                className={btnPrimary}
                disabled={busy === "rollout"}
                onClick={() =>
                  run("rollout", () => prepareDecision({ data: { ...ids, kind: "rollout" } })).then(
                    onChanged,
                  )
                }
              >
                {busy === "rollout" ? "Writing copy for every page…" : "Roll out"}
              </button>
            )}
            {d.actions.rollback && (
              <button
                type="button"
                className={btnGhost}
                disabled={busy === "rollback"}
                onClick={() =>
                  run("rollback", () =>
                    prepareDecision({ data: { ...ids, kind: "rollback" } }),
                  ).then(onChanged)
                }
              >
                Roll back
              </button>
            )}
            {d.actions.keep && (
              <button
                type="button"
                className={btnQuiet}
                onClick={() => run("keep", () => keep({ data: ids }), "Closed.").then(onChanged)}
              >
                Keep as it is
              </button>
            )}
            {d.actions.close && (
              <button
                type="button"
                className={btnQuiet}
                onClick={() => run("close", () => close({ data: ids }), "Closed.").then(onChanged)}
              >
                Close without rolling back
              </button>
            )}
          </div>
        )}
        {d.actions.share && <ShareButton workspaceId={workspaceId} d={d} />}
      </Tile>
    );
  }

  if (d.status === "closed" && d.actions.share) {
    return (
      <Tile>
        <ShareButton workspaceId={workspaceId} d={d} />
      </Tile>
    );
  }
  return null;
}

function ShareButton({ workspaceId, d }: { workspaceId: string; d: ExperimentDetail }) {
  const { busy, run } = useAction();
  const [url, setUrl] = useState<string | null>(null);
  if (d.shareSlug && !url) {
    return (
      <p className="text-[13px] text-muted-foreground">
        Shared with your client. Manage links in the client portal.
      </p>
    );
  }
  return url ? (
    <div className="flex items-center gap-2">
      <input
        className={cn(inputBase, "py-2 text-[13px]")}
        readOnly
        value={url}
        onFocus={(e) => e.target.select()}
      />
      <button
        type="button"
        className={btnGhost}
        onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copied."))}
      >
        Copy
      </button>
    </div>
  ) : (
    <button
      type="button"
      className={btnGhost}
      disabled={busy === "share"}
      onClick={async () => {
        const out = await run("share", async () => {
          const { supabase } = await import("@/integrations/supabase/client");
          const { data: session } = await supabase.auth.getSession();
          const res = await fetch("/api/shares?action=create", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(session.session
                ? { authorization: `Bearer ${session.session.access_token}` }
                : {}),
            },
            body: JSON.stringify({
              workspaceId,
              title: `Test result: ${d.name}`.slice(0, 200),
              allowComments: true,
              allowApprovals: false,
              items: [{ kind: "experiment_report", refId: d.id, title: d.name.slice(0, 200) }],
            }),
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error ?? "Couldn't create the link.");
          return json as { url: string };
        });
        if (out) setUrl(out.url);
      }}
    >
      Share with client
    </button>
  );
}

function ResultSection({ d }: { d: ExperimentDetail }) {
  const r = d.result!;
  const final = d.verdict !== null;
  const lift = final ? d.lift : r.lift;
  return (
    <div className="space-y-3">
      <GroupLabel>{final ? "Result" : "Early read (not final)"}</GroupLabel>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label={`Change in ${METRIC_LABELS[d.primaryMetric].toLowerCase()}`}
          value={formatLift(lift)}
          hint={
            final && d.liftLow !== null && d.liftHigh !== null
              ? `Likely between ${formatLift(d.liftLow)} and ${formatLift(d.liftHigh)}`
              : r.ci95
                ? `Could be anywhere from ${formatLift(r.ci95[0])} to ${formatLift(r.ci95[1])}`
                : undefined
          }
        />
        <Stat label="Days measured" value={String(r.postDays)} hint={`${r.pairs} page pairs`} />
        <Stat
          label="Estimated value"
          value={
            r.monthlyValue !== null
              ? `${formatMoney(r.monthlyValue, r.currency)} / mo`
              : r.extraPerMonth !== null
                ? `${Math.round(r.extraPerMonth).toLocaleString()} ${r.unit} / mo`
                : "—"
          }
          hint={r.valueNote ?? undefined}
        />
      </div>
      <ResultChart daily={r.daily} />
      {!final && r.reason && <p className="text-[12.5px] text-muted-foreground">{r.reason}</p>}
    </div>
  );
}

function PairsSection({
  workspaceId,
  d,
  onChanged,
}: {
  workspaceId: string;
  d: ExperimentDetail;
  onChanged: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const edit = useServerFn(fns.editExperimentValue);
  const { busy, run } = useAction();
  if (!d.pairs.length) return null;
  const canEdit = d.canEdit && d.status === "draft" && d.changeType !== "faq";
  const shown = showAll ? d.pairs : d.pairs.slice(0, 8);
  return (
    <div className="space-y-2">
      <GroupLabel>
        {d.pairs.length} test pages and {d.pairs.length} comparison pages
        {d.excludedCount ? ` · ${d.excludedCount} left out` : ""}
      </GroupLabel>
      {shown.map((p) => (
        <div
          key={p.stratum}
          className="rounded-xl border border-border/60 p-3 text-[13px] space-y-1.5"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px]">{p.treatment.path}</span>
            {canEdit && !p.treatment.excluded && editing !== p.treatment.path && (
              <button
                type="button"
                className={btnQuiet}
                onClick={() => {
                  setEditing(p.treatment.path);
                  setValue(typeof p.treatment.after === "string" ? p.treatment.after : "");
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
          </div>
          {p.treatment.excluded ? (
            <p className="text-muted-foreground">{p.treatment.excluded}</p>
          ) : editing === p.treatment.path ? (
            <div className="space-y-2">
              <textarea
                className={cn(inputBase, "min-h-[70px] text-[13.5px]")}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={btnPrimary}
                  disabled={busy === "save"}
                  onClick={async () => {
                    const ok = await run(
                      "save",
                      () =>
                        edit({
                          data: { workspaceId, experimentId: d.id, path: p.treatment.path, value },
                        }),
                      "Saved.",
                    );
                    if (ok) {
                      setEditing(null);
                      onChanged();
                    }
                  }}
                >
                  Save
                </button>
                <button type="button" className={btnQuiet} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <>
              {p.treatment.before && (
                <p className="text-muted-foreground line-through">{p.treatment.before}</p>
              )}
              <p>
                {typeof p.treatment.after === "string"
                  ? p.treatment.after
                  : Array.isArray(p.treatment.after)
                    ? p.treatment.after.map((f) => f.question).join(" · ")
                    : "—"}
              </p>
            </>
          )}
          <p className="text-[12px] text-muted-foreground">
            Compared with {p.control.path} (unchanged)
          </p>
        </div>
      ))}
      {d.pairs.length > 8 && (
        <button type="button" className={btnQuiet} onClick={() => setShowAll(!showAll)}>
          {showAll ? "Show fewer" : `Show all ${d.pairs.length}`}
        </button>
      )}
    </div>
  );
}

/* ───────────────────────── branding ───────────────────────── */

function BrandingPage({ workspaceId, data }: { workspaceId: string; data: ExperimentsOverview }) {
  const qc = useQueryClient();
  const save = useServerFn(fns.setReportBranding);
  const { busy, run } = useAction();
  const [name, setName] = useState(data.branding.displayName ?? "");
  const [logo, setLogo] = useState<{
    base64: string;
    contentType: "image/png" | "image/jpeg" | "image/webp";
  } | null>(null);
  const [remove, setRemove] = useState(false);
  const preview = logo
    ? `data:${logo.contentType};base64,${logo.base64}`
    : remove
      ? null
      : data.branding.logoUrl;

  return (
    <SurfacePage
      title="Client report"
      subtitle="The name and logo on shared test results."
      width="narrow"
    >
      <div className="space-y-4">
        <input
          className={inputBase}
          placeholder={data.branding.fallbackName}
          value={name}
          disabled={!data.canManage}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="flex items-center gap-3">
          {preview ? (
            <img
              src={preview}
              alt=""
              className="h-10 w-auto max-w-[160px] rounded object-contain"
            />
          ) : (
            <span className="text-[13px] text-muted-foreground">No logo</span>
          )}
          {data.canManage && (
            <>
              <label className={cn(btnGhost, "cursor-pointer")}>
                Upload logo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > 1_000_000) {
                      toast.error("The logo must be under 1 MB.");
                      return;
                    }
                    const reader = new FileReader();
                    reader.onload = () => {
                      const result = String(reader.result);
                      setLogo({
                        base64: result.slice(result.indexOf(",") + 1),
                        contentType: file.type as "image/png" | "image/jpeg" | "image/webp",
                      });
                      setRemove(false);
                    };
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
              {preview && (
                <button
                  type="button"
                  className={btnQuiet}
                  onClick={() => {
                    setLogo(null);
                    setRemove(true);
                  }}
                >
                  Remove
                </button>
              )}
            </>
          )}
        </div>
        {data.canManage ? (
          <button
            type="button"
            className={btnPrimary}
            disabled={busy === "save"}
            onClick={async () => {
              const out = await run(
                "save",
                () =>
                  save({
                    data: {
                      workspaceId,
                      displayName: name.trim() || null,
                      logo,
                      removeLogo: remove,
                    },
                  }),
                "Saved.",
              );
              if (out) {
                setLogo(null);
                setRemove(false);
                qc.invalidateQueries({ queryKey: ["experiments", workspaceId, "overview"] });
              }
            }}
          >
            Save
          </button>
        ) : (
          <p className="text-[13px] text-muted-foreground">Only admins can change this.</p>
        )}
      </div>
    </SurfacePage>
  );
}

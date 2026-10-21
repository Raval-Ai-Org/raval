"use client";

// AI controls — which model answers each feature, and how much AI the platform
// (or one workspace) may spend. Routing can only choose among models the
// built-in plans already use, and an environment variable always outranks an
// override. Caps are checked before every paid call. Both are sensitive, so a
// change needs a written reason and, when two steps are required, a fresh code.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SurfacePage, GroupLabel, Stat, Tile } from "@/components/app/surface/SurfaceLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Wallet } from "@/components/icons";
import { toast } from "@/lib/toast";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminAiControls, AdminAiRoute, AdminSpendCap } from "@/lib/admin/types";
import { AdminApiError, adminApi, errorMessage, useAdminMe } from "./api";
import { LoadError } from "./LoadError";
import { MfaPanel } from "./MfaPanel";
import { ago, fmtUsd } from "./format";
import { Chip, Field, TableFrame, fieldClass, rowClass, td, textareaClass, th } from "./parts";

type Pending = { path: string; body: Record<string, unknown> };
type Effort = "low" | "medium" | "high";

type RouteDraft = { route: string; models: string[]; effort: Effort | ""; reason: string };
type CapDraft = {
  scope: "global" | "workspace";
  workspaceId: string;
  daily: string;
  monthly: string;
  reason: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE: Record<
  AdminAiRoute["source"],
  { label: string; tone: "neutral" | "primary" | "warning" }
> = {
  default: { label: "Built-in", tone: "neutral" },
  override: { label: "Overridden", tone: "primary" },
  environment: { label: "Set by environment", tone: "warning" },
};

const parseUsd = (text: string): number | null | "bad" => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 ? value : "bad";
};

export function AiControlsScreen() {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const [route, setRoute] = useState<RouteDraft | null>(null);
  const [cap, setCap] = useState<CapDraft | null>(null);
  const [stepUp, setStepUp] = useState<Pending | null>(null);
  const [filter, setFilter] = useState("");
  const can = (permission: Parameters<typeof hasPermission>[1]) =>
    me.data ? hasPermission(me.data.permissions, permission) : false;

  const controls = useQuery({
    queryKey: ["admin", "ai"],
    queryFn: () => adminApi<AdminAiControls>("/api/admin/ai"),
  });

  const send = useMutation({
    mutationFn: (pending: Pending) =>
      adminApi<unknown>(pending.path, { method: "POST", body: pending.body }),
    onSuccess: () => {
      toast.success("Saved.");
      setRoute(null);
      setCap(null);
      setStepUp(null);
      void queryClient.invalidateQueries({ queryKey: ["admin", "ai"] });
    },
    onError: (error, pending) => {
      if (error instanceof AdminApiError && error.code === "reauth_required") {
        setStepUp(pending);
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const data = controls.data;
  const globalCap = data?.caps.find((c) => c.scope === "global") ?? null;
  const workspaceCaps = data?.caps.filter((c) => c.scope === "workspace") ?? [];

  const capDaily = cap ? parseUsd(cap.daily) : null;
  const capMonthly = cap ? parseUsd(cap.monthly) : null;
  const capValid =
    cap !== null &&
    capDaily !== "bad" &&
    capMonthly !== "bad" &&
    cap.reason.trim().length >= 10 &&
    (cap.scope === "global" || UUID.test(cap.workspaceId.trim())) &&
    (capDaily === null || capMonthly === null || capMonthly >= capDaily);

  const routeValid = route !== null && route.models.length > 0 && route.reason.trim().length >= 10;
  const routes = (data?.routes ?? []).filter(
    (r) => !filter.trim() || r.route.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  function editCap(source: AdminSpendCap | null, scope: "global" | "workspace") {
    setCap({
      scope,
      workspaceId: source?.workspaceId ?? "",
      daily: source?.dailyUsd?.toString() ?? "",
      monthly: source?.monthlyUsd?.toString() ?? "",
      reason: "",
    });
  }

  return (
    <SurfacePage
      title="AI controls"
      subtitle="Which model answers each feature, and how much AI may be spent"
    >
      {stepUp && (
        <div className="mb-5">
          <MfaPanel
            mode="reauth"
            onVerified={() => {
              const pending = stepUp;
              setStepUp(null);
              send.mutate(pending);
            }}
          />
        </div>
      )}
      {controls.isLoading && <Skeleton className="h-64 rounded-2xl" />}
      {controls.error && (
        <LoadError error={controls.error} onRetry={() => void controls.refetch()} />
      )}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat
              label="Estimated spend today"
              value={data.spend ? fmtUsd(data.spend.todayUsd) : "—"}
              icon={Wallet}
              hint={
                globalCap?.dailyUsd != null
                  ? `Platform cap ${fmtUsd(globalCap.dailyUsd)}`
                  : "No daily cap"
              }
              tone={
                data.spend &&
                globalCap?.dailyUsd != null &&
                data.spend.todayUsd >= globalCap.dailyUsd
                  ? "destructive"
                  : "default"
              }
            />
            <Stat
              label="Estimated spend this month"
              value={data.spend ? fmtUsd(data.spend.monthUsd) : "—"}
              hint={
                globalCap?.monthlyUsd != null
                  ? `Platform cap ${fmtUsd(globalCap.monthlyUsd)}`
                  : "No monthly cap"
              }
              tone={
                data.spend &&
                globalCap?.monthlyUsd != null &&
                data.spend.monthUsd >= globalCap.monthlyUsd
                  ? "destructive"
                  : "default"
              }
            />
            <Stat label="Workspace caps" value={workspaceCaps.length} />
          </div>

          <GroupLabel>Spend caps</GroupLabel>
          {cap && (
            <Tile className="mb-4 space-y-4 p-4">
              <h3 className="text-[14px] font-semibold">
                {cap.scope === "global" ? "Platform-wide cap" : "Workspace cap"}
              </h3>
              <p className="text-[12.5px] text-muted-foreground">
                {cap.scope === "global"
                  ? "When reached, every paid AI call stops until the day or month rolls over."
                  : "When reached, writing moves to the economy model; images, video and web search stop."}{" "}
                Leave both blank to remove the cap.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                {cap.scope === "workspace" && (
                  <Field label="Workspace id" hint="Find it under Support">
                    <input
                      className={fieldClass}
                      value={cap.workspaceId}
                      onChange={(event) => setCap({ ...cap, workspaceId: event.target.value })}
                      spellCheck={false}
                    />
                  </Field>
                )}
                <Field label="Daily limit (USD)">
                  <input
                    className={fieldClass}
                    inputMode="decimal"
                    value={cap.daily}
                    onChange={(event) => setCap({ ...cap, daily: event.target.value })}
                  />
                </Field>
                <Field
                  label="Monthly limit (USD)"
                  hint={
                    capDaily !== "bad" &&
                    capMonthly !== "bad" &&
                    capDaily !== null &&
                    capMonthly !== null &&
                    capMonthly < capDaily
                      ? "The monthly limit can't be below the daily one."
                      : undefined
                  }
                >
                  <input
                    className={fieldClass}
                    inputMode="decimal"
                    value={cap.monthly}
                    onChange={(event) => setCap({ ...cap, monthly: event.target.value })}
                  />
                </Field>
              </div>
              <Field label="Reason" hint="At least 10 characters, saved in the audit log">
                <textarea
                  className={textareaClass}
                  value={cap.reason}
                  maxLength={300}
                  onChange={(event) => setCap({ ...cap, reason: event.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={!capValid || send.isPending}
                  onClick={() =>
                    send.mutate({
                      path: "/api/admin/ai/caps",
                      body: {
                        scope: cap.scope,
                        workspaceId: cap.scope === "workspace" ? cap.workspaceId.trim() : null,
                        dailyUsd: capDaily === "bad" ? null : capDaily,
                        monthlyUsd: capMonthly === "bad" ? null : capMonthly,
                        reason: cap.reason.trim(),
                      },
                    })
                  }
                >
                  {send.isPending ? "Saving…" : "Save cap"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={send.isPending}
                  onClick={() => setCap(null)}
                >
                  Cancel
                </Button>
              </div>
            </Tile>
          )}
          <TableFrame label="Spend caps">
            <thead>
              <tr>
                <th className={th}>Applies to</th>
                <th className={`${th} text-right`}>Daily</th>
                <th className={`${th} text-right`}>Monthly</th>
                <th className={th}>Changed</th>
                {can("ai.caps.manage") && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              <tr className={rowClass}>
                <td className={`${td} font-medium`}>Whole platform</td>
                <td className={`${td} text-right tabular-nums`}>
                  {globalCap?.dailyUsd != null ? fmtUsd(globalCap.dailyUsd) : "—"}
                </td>
                <td className={`${td} text-right tabular-nums`}>
                  {globalCap?.monthlyUsd != null ? fmtUsd(globalCap.monthlyUsd) : "—"}
                </td>
                <td className={td}>{globalCap ? ago(globalCap.updatedAt) : "—"}</td>
                {can("ai.caps.manage") && (
                  <td className={`${td} text-right`}>
                    <Button size="sm" variant="ghost" onClick={() => editCap(globalCap, "global")}>
                      {globalCap ? "Edit" : "Set cap"}
                    </Button>
                  </td>
                )}
              </tr>
              {workspaceCaps.map((c) => (
                <tr key={c.workspaceId} className={rowClass}>
                  <td className={`${td} font-medium`}>{c.workspaceName ?? c.workspaceId}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    {c.dailyUsd != null ? fmtUsd(c.dailyUsd) : "—"}
                  </td>
                  <td className={`${td} text-right tabular-nums`}>
                    {c.monthlyUsd != null ? fmtUsd(c.monthlyUsd) : "—"}
                  </td>
                  <td className={td}>{ago(c.updatedAt)}</td>
                  {can("ai.caps.manage") && (
                    <td className={`${td} text-right`}>
                      <Button size="sm" variant="ghost" onClick={() => editCap(c, "workspace")}>
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableFrame>
          {can("ai.caps.manage") && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => editCap(null, "workspace")}>
                Add a workspace cap
              </Button>
            </div>
          )}

          <GroupLabel>Model routing</GroupLabel>
          {route && (
            <Tile className="mb-4 space-y-4 p-4">
              <h3 className="text-[14px] font-semibold">{route.route}</h3>
              <div className="grid gap-4 sm:grid-cols-3">
                {[0, 1, 2].map((slot) => (
                  <Field
                    key={slot}
                    label={slot === 0 ? "Model" : `Fallback ${slot}`}
                    hint={slot === 0 ? "Answers first" : "Used if the one before fails"}
                  >
                    <select
                      className={fieldClass}
                      value={route.models[slot] ?? ""}
                      onChange={(event) => {
                        const next = [...route.models];
                        if (event.target.value) next[slot] = event.target.value;
                        else next.splice(slot);
                        setRoute({ ...route, models: next.filter(Boolean) });
                      }}
                      disabled={slot > route.models.length}
                    >
                      {slot > 0 && <option value="">None</option>}
                      {data.models.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                      {slot === 0 && !route.models[0] && <option value="">Choose…</option>}
                    </select>
                  </Field>
                ))}
              </div>
              <Field label="Reasoning effort">
                <select
                  className={fieldClass}
                  value={route.effort}
                  onChange={(event) =>
                    setRoute({ ...route, effort: event.target.value as Effort | "" })
                  }
                >
                  <option value="">Built-in default</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </Field>
              <Field label="Reason" hint="At least 10 characters, saved in the audit log">
                <textarea
                  className={textareaClass}
                  value={route.reason}
                  maxLength={300}
                  onChange={(event) => setRoute({ ...route, reason: event.target.value })}
                />
              </Field>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!routeValid || send.isPending}
                  onClick={() =>
                    send.mutate({
                      path: "/api/admin/ai/routing",
                      body: {
                        route: route.route,
                        models: route.models,
                        effort: route.effort || null,
                        reason: route.reason.trim(),
                      },
                    })
                  }
                >
                  {send.isPending ? "Saving…" : "Save override"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={route.reason.trim().length < 10 || send.isPending}
                  onClick={() =>
                    send.mutate({
                      path: "/api/admin/ai/routing",
                      body: {
                        route: route.route,
                        models: null,
                        effort: null,
                        reason: route.reason.trim(),
                      },
                    })
                  }
                >
                  Back to built-in
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={send.isPending}
                  onClick={() => setRoute(null)}
                >
                  Cancel
                </Button>
              </div>
            </Tile>
          )}
          <label className="mb-3 block max-w-sm">
            <span className="sr-only">Filter routes</span>
            <input
              className={fieldClass}
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter features…"
              spellCheck={false}
            />
          </label>
          <TableFrame label="Model routing">
            <thead>
              <tr>
                <th className={th}>Feature (route)</th>
                <th className={th}>Models</th>
                <th className={th}>Effort</th>
                <th className={th}>Source</th>
                {can("ai.routing.manage") && <th className={th} />}
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr key={r.route} className={rowClass}>
                  <td className={`${td} font-medium`}>{r.route}</td>
                  <td className={`${td} text-[12.5px]`}>
                    {r.models.map((model, i) => (
                      <span key={model} className="block">
                        {i === 0 ? (
                          model
                        ) : (
                          <span className="text-muted-foreground">then {model}</span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className={td}>{r.effort ?? "—"}</td>
                  <td className={td}>
                    <Chip tone={SOURCE[r.source].tone}>{SOURCE[r.source].label}</Chip>
                  </td>
                  {can("ai.routing.manage") && (
                    <td className={`${td} text-right`}>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={r.source === "environment"}
                        title={
                          r.source === "environment"
                            ? "An environment variable sets this route and outranks an override"
                            : undefined
                        }
                        onClick={() =>
                          setRoute({
                            route: r.route,
                            models: r.override?.models ?? r.models,
                            effort: r.override?.effort ?? "",
                            reason: "",
                          })
                        }
                      >
                        Edit
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </>
      )}
    </SurfacePage>
  );
}

"use client";

// Entitlements of one workspace: what it may do, whether that comes from its
// plan or from an exception staff set, and a form to add or end an exception.
// The numbers come from the same resolver the product enforces; this screen
// never works out a plan's rules on its own.

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { ErrorState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/lib/toast";
import { FEATURES, type FeatureKey } from "@/lib/billing/catalog";
import { OVERRIDE_LIMIT_KEYS, overridableFeatures } from "@/lib/billing/overrides";
import { hasPermission } from "@/lib/admin/permissions";
import type { AdminEntitlementView, AdminOverrideRow } from "@/lib/admin/types";
import { adminApi, errorMessage, useAdminMe } from "./api";
import { ConfirmAction } from "./ConfirmAction";
import { fmtDate, fmtDateTime, fmtNumber } from "./format";
import { Chip, Field, TableFrame, fieldClass, rowClass, td, textareaClass, th } from "./parts";

export const LIMIT_LABELS: Record<string, string> = {
  trackedPrompts: "Tracked prompts",
  scansPerMonth: "Site scans per month",
  geoMaxPages: "Pages per scan",
  competitors: "Tracked competitors",
  competitorSweepsPerWeek: "Competitor checks per week",
  marketBrainWeeklyBrands: "Market Brain brands",
  coachWeeklyBriefings: "Coach briefings per week",
  postsFairUse: "Posts per month (fair use)",
  maxConcurrentExperiments: "Running experiments",
  maxConcurrentRenders: "Videos rendering at once",
};

function overrideLabel(row: Pick<AdminOverrideRow, "kind" | "key">): string {
  return row.kind === "feature"
    ? (FEATURES[row.key as FeatureKey]?.label ?? row.key)
    : (LIMIT_LABELS[row.key] ?? row.key);
}

const STATUS_TONE = {
  active: "success",
  scheduled: "primary",
  expired: "neutral",
  revoked: "neutral",
} as const;

type Draft = {
  scope: "workspace" | "account";
  kind: "feature" | "limit";
  key: string;
  allowed: "allow" | "deny";
  limitValue: string;
  ends: "7" | "30" | "90" | "custom" | "never";
  endDate: string;
  reason: string;
};

const FEATURE_OPTIONS = overridableFeatures();

const EMPTY: Draft = {
  scope: "workspace",
  kind: "feature",
  key: FEATURE_OPTIONS[0] ?? "",
  allowed: "allow",
  limitValue: "",
  ends: "30",
  endDate: "",
  reason: "",
};

function endIso(draft: Draft): string | undefined {
  if (draft.ends === "never") return undefined;
  if (draft.ends === "custom") {
    return draft.endDate ? new Date(`${draft.endDate}T23:59:59`).toISOString() : undefined;
  }
  return new Date(Date.now() + Number(draft.ends) * 86_400_000).toISOString();
}

export function WorkspaceEntitlements({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const me = useAdminMe();
  const canOverride = me.data ? hasPermission(me.data.permissions, "entitlements.override") : false;
  const key = useMemo(() => ["admin", "entitlements", workspaceId], [workspaceId]);

  const view = useQuery({
    queryKey: key,
    queryFn: () =>
      adminApi<AdminEntitlementView>(`/api/admin/entitlements?workspaceId=${workspaceId}`),
  });

  const [draft, setDraft] = useState<Draft | null>(null);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    void queryClient.invalidateQueries({ queryKey: ["admin", "audit"] });
  };

  const create = useMutation({
    mutationFn: (value: Draft) =>
      adminApi("/api/admin/entitlements/overrides", {
        method: "POST",
        body: {
          workspaceId,
          scope: value.scope,
          kind: value.kind,
          key: value.key,
          ...(value.kind === "feature"
            ? { allowed: value.allowed === "allow" }
            : { limitValue: Number(value.limitValue) }),
          expiresAt: endIso(value),
          reason: value.reason.trim(),
        },
      }),
    onSuccess: () => {
      toast.success("Override saved.");
      setDraft(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const end = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      adminApi("/api/admin/entitlements/overrides/revoke", {
        method: "POST",
        body: { id, reason },
      }),
    onSuccess: () => {
      toast.success("Override ended.");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (view.isLoading) return <Skeleton className="mt-6 h-48 rounded-2xl" />;
  if (view.error || !view.data) {
    return (
      <div className="mt-6">
        <ErrorState
          title="Couldn't load entitlements"
          description={view.error?.message ?? "Try again in a moment."}
          onRetry={() => void view.refetch()}
        />
      </div>
    );
  }

  const { account, features, limits, fixedLimits, overrides } = view.data;
  const sold = features.filter((feature) => feature.sold);
  const changed = sold.filter((feature) => feature.allowed !== feature.planAllows);
  const draftValid = draft
    ? draft.reason.trim().length >= 10 &&
      (draft.kind === "feature" ||
        (draft.limitValue !== "" &&
          Number.isInteger(Number(draft.limitValue)) &&
          Number(draft.limitValue) >= 0)) &&
      (draft.ends !== "custom" || Boolean(draft.endDate))
    : false;

  return (
    <>
      <GroupLabel
        action={
          canOverride && !draft ? (
            <Button size="sm" variant="outline" onClick={() => setDraft({ ...EMPTY })}>
              Add override
            </Button>
          ) : undefined
        }
      >
        Entitlements
      </GroupLabel>

      <div className="mb-3 flex flex-wrap gap-1.5">
        <Chip tone="primary">{account.entitledPlan} plan</Chip>
        <Chip>{account.status.replace("_", " ")}</Chip>
        <Chip tone={account.enforcement === "on" ? "success" : "warning"}>
          Limits {account.enforcement === "on" ? "enforced" : account.enforcement}
        </Chip>
        {!account.overridesEnabled && <Chip tone="danger">Overrides switched off</Chip>}
        {changed.length > 0 && <Chip tone="warning">{changed.length} differ from the plan</Chip>}
      </div>
      {account.enforcement !== "on" && (
        <p className="mb-3 text-[12.5px] text-muted-foreground">
          Billing enforcement is {account.enforcement}, so plan limits aren&apos;t blocking anything
          yet.
        </p>
      )}

      {draft && (
        <form
          className="mb-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (draftValid) create.mutate(draft);
          }}
        >
          <Tile className="space-y-4">
            <h4 className="text-[14px] font-semibold">Add an override</h4>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Applies to">
                <select
                  className={fieldClass}
                  value={draft.scope}
                  onChange={(event) =>
                    setDraft({ ...draft, scope: event.target.value as Draft["scope"] })
                  }
                >
                  <option value="workspace">This brand only</option>
                  <option value="account">All of the owner&apos;s brands</option>
                </select>
              </Field>
              <Field label="Type">
                <select
                  className={fieldClass}
                  value={draft.kind}
                  onChange={(event) => {
                    const kind = event.target.value as Draft["kind"];
                    setDraft({
                      ...draft,
                      kind,
                      key:
                        kind === "feature"
                          ? (FEATURE_OPTIONS[0] ?? "")
                          : (OVERRIDE_LIMIT_KEYS[0] ?? ""),
                    });
                  }}
                >
                  <option value="feature">A feature</option>
                  <option value="limit">A limit</option>
                </select>
              </Field>
              <Field label={draft.kind === "feature" ? "Feature" : "Limit"}>
                <select
                  className={fieldClass}
                  value={draft.key}
                  onChange={(event) => setDraft({ ...draft, key: event.target.value })}
                >
                  {draft.kind === "feature"
                    ? FEATURE_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {FEATURES[option].label}
                        </option>
                      ))
                    : OVERRIDE_LIMIT_KEYS.map((option) => (
                        <option key={option} value={option}>
                          {LIMIT_LABELS[option]}
                        </option>
                      ))}
                </select>
              </Field>
              {draft.kind === "feature" ? (
                <Field label="Set to">
                  <select
                    className={fieldClass}
                    value={draft.allowed}
                    onChange={(event) =>
                      setDraft({ ...draft, allowed: event.target.value as Draft["allowed"] })
                    }
                  >
                    <option value="allow">Allowed</option>
                    <option value="deny">Not allowed</option>
                  </select>
                </Field>
              ) : (
                <Field label="New limit" hint="A whole number. Brands and seats follow the plan.">
                  <input
                    inputMode="numeric"
                    className={fieldClass}
                    value={draft.limitValue}
                    onChange={(event) =>
                      setDraft({ ...draft, limitValue: event.target.value.replace(/\D/g, "") })
                    }
                  />
                </Field>
              )}
              <Field label="Ends">
                <select
                  className={fieldClass}
                  value={draft.ends}
                  onChange={(event) =>
                    setDraft({ ...draft, ends: event.target.value as Draft["ends"] })
                  }
                >
                  <option value="7">In 7 days</option>
                  <option value="30">In 30 days</option>
                  <option value="90">In 90 days</option>
                  <option value="custom">On a date…</option>
                  <option value="never">Never (until ended by hand)</option>
                </select>
              </Field>
              {draft.ends === "custom" && (
                <Field label="End date">
                  <input
                    type="date"
                    className={fieldClass}
                    value={draft.endDate}
                    min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)}
                    onChange={(event) => setDraft({ ...draft, endDate: event.target.value })}
                  />
                </Field>
              )}
            </div>
            <Field label="Reason" hint="At least 10 characters. Saved in the audit log.">
              <textarea
                className={textareaClass}
                maxLength={300}
                value={draft.reason}
                onChange={(event) => setDraft({ ...draft, reason: event.target.value })}
                required
              />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={!draftValid || create.isPending}>
                {create.isPending ? "Saving…" : "Save override"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
                disabled={create.isPending}
              >
                Cancel
              </Button>
            </div>
          </Tile>
        </form>
      )}

      <TableFrame label="Features">
        <thead>
          <tr>
            <th className={th}>Feature</th>
            <th className={th}>Plan says</th>
            <th className={th}>Right now</th>
            <th className={th}>From</th>
          </tr>
        </thead>
        <tbody>
          {sold.map((feature) => (
            <tr key={feature.key} className={rowClass}>
              <td className={td}>
                <span className="font-medium">{feature.label}</span>
                <span className="ml-2 text-[12px] text-muted-foreground">{feature.module}</span>
              </td>
              <td className={td}>
                {feature.planAllows ? "Included" : `From ${feature.requiredPlan}`}
              </td>
              <td className={td}>
                <Chip tone={feature.allowed ? "success" : "neutral"}>
                  {feature.allowed ? "Allowed" : "Not allowed"}
                </Chip>
              </td>
              <td className={td}>
                {feature.source === "override" ? (
                  <Chip tone="warning">Override · {feature.overrideScope}</Chip>
                ) : (
                  <span className="text-muted-foreground">Plan</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <div className="mt-4" />
      <TableFrame label="Limits">
        <thead>
          <tr>
            <th className={th}>Limit</th>
            <th className={th}>Plan says</th>
            <th className={th}>Right now</th>
            <th className={th}>Used</th>
            <th className={th}>From</th>
          </tr>
        </thead>
        <tbody>
          {limits.map((limit) => (
            <tr key={limit.key} className={rowClass}>
              <td className={td}>{LIMIT_LABELS[limit.key] ?? limit.key}</td>
              <td className={`${td} tabular-nums`}>{fmtNumber(limit.planValue)}</td>
              <td className={`${td} tabular-nums font-medium`}>{fmtNumber(limit.effective)}</td>
              <td className={`${td} tabular-nums`}>
                {limit.used === null ? "—" : fmtNumber(limit.used)}
              </td>
              <td className={td}>
                {limit.source === "override" ? (
                  <Chip tone="warning">Override · {limit.overrideScope}</Chip>
                ) : (
                  <span className="text-muted-foreground">Plan</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </TableFrame>
      <p className="mt-2 text-[12.5px] text-muted-foreground">
        {fixedLimits
          .map(
            (item) =>
              `${item.key === "brands" ? "Brands" : "Seats"}: ${item.used} of ${item.effective ?? "unlimited"}`,
          )
          .join(" · ")}{" "}
        (follow the plan)
      </p>

      <GroupLabel>Overrides</GroupLabel>
      {overrides.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No overrides have been set.</p>
      ) : (
        <Tile className="p-0">
          <ul>
            {overrides.map((row) => (
              <li
                key={row.id}
                className="space-y-1.5 border-t border-border/50 px-4 py-3 first:border-t-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13.5px] font-medium">
                    {overrideLabel(row)} →{" "}
                    {row.kind === "feature"
                      ? row.allowed
                        ? "allowed"
                        : "not allowed"
                      : fmtNumber(row.limitValue ?? 0)}
                  </span>
                  <Chip tone={STATUS_TONE[row.status]}>{row.status}</Chip>
                  <Chip>{row.scope === "workspace" ? "This brand" : "All brands"}</Chip>
                </div>
                <p className="text-[12.5px] text-muted-foreground">
                  {row.expiresAt ? `Ends ${fmtDate(row.expiresAt)}` : "No end date"} · set by{" "}
                  {row.createdBy ?? "unknown"} on {fmtDateTime(row.createdAt)}
                </p>
                <p className="text-[13px]">“{row.reason}”</p>
                {row.revokedAt && (
                  <p className="text-[12.5px] text-muted-foreground">
                    Ended {fmtDateTime(row.revokedAt)}
                    {row.revokeReason ? ` — ${row.revokeReason}` : ""}
                  </p>
                )}
                {canOverride && (row.status === "active" || row.status === "scheduled") && (
                  <ConfirmAction
                    label="End now"
                    description="It stops applying straight away."
                    onConfirm={(reason) =>
                      end.mutateAsync({ id: row.id, reason }).then(() => undefined)
                    }
                  />
                )}
              </li>
            ))}
          </ul>
        </Tile>
      )}
    </>
  );
}

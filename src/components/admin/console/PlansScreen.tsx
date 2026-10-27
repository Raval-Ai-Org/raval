"use client";

// Plans — a read-only look at what each plan includes, straight from the
// pricing catalog the product enforces (src/lib/billing/catalog.ts). To make an
// exception for one customer, use Overrides on that workspace.

import { SurfacePage, GroupLabel, Tile } from "@/components/app/surface/SurfaceLayout";
import { FEATURES, PLANS, PLAN_ORDER, planAllows, type FeatureKey } from "@/lib/billing/catalog";
import { OVERRIDE_LIMIT_KEYS } from "@/lib/billing/overrides";
import { CREATION_PLANS } from "@/lib/billing/creation";
import { fmtNumber } from "./format";
import { LIMIT_LABELS } from "./WorkspaceEntitlements";
import { Chip, TableFrame, rowClass, td, th } from "./parts";

export function PlansScreen() {
  const features = (Object.keys(FEATURES) as FeatureKey[]).filter(
    (key) => (FEATURES[key].availability ?? "launch") === "launch",
  );
  return (
    <SurfacePage
      title="Plans"
      subtitle="What each plan includes. Change a number in the pricing catalog; use an override for one customer."
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          return (
            <Tile key={id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[15px] font-semibold">{plan.label}</p>
                {plan.badge && <Chip tone="primary">{plan.badge}</Chip>}
              </div>
              <p className="text-[13px] text-muted-foreground">{plan.tagline}</p>
              <p className="text-[13px] tabular-nums">
                ${plan.priceMonthlyUsd}/month · ${plan.priceAnnualUsd}/year
              </p>
              <p className="text-[12.5px] text-muted-foreground">
                {plan.brands} brand{plan.brands === 1 ? "" : "s"} ·{" "}
                {plan.seats === null
                  ? "unlimited seats"
                  : `${plan.seats} seat${plan.seats === 1 ? "" : "s"}`}{" "}
                · {fmtNumber(CREATION_PLANS[id].points)} creation points + {fmtNumber(CREATION_PLANS[id].flexCredits)} wallet credits a month (new grant windows)
              </p>
            </Tile>
          );
        })}
      </div>

      <GroupLabel>Limits</GroupLabel>
      <TableFrame label="Limits by plan">
        <thead>
          <tr>
            <th className={th}>Limit</th>
            {PLAN_ORDER.map((id) => (
              <th key={id} className={th}>
                {PLANS[id].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {OVERRIDE_LIMIT_KEYS.map((key) => (
            <tr key={key} className={rowClass}>
              <td className={td}>{LIMIT_LABELS[key]}</td>
              {PLAN_ORDER.map((id) => (
                <td key={id} className={`${td} tabular-nums`}>
                  {fmtNumber(PLANS[id].limits[key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <GroupLabel>Features</GroupLabel>
      <TableFrame label="Features by plan">
        <thead>
          <tr>
            <th className={th}>Feature</th>
            {PLAN_ORDER.map((id) => (
              <th key={id} className={th}>
                {PLANS[id].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((key) => (
            <tr key={key} className={rowClass}>
              <td className={td}>
                <span className="font-medium">{FEATURES[key].label}</span>
                <span className="ml-2 text-[12px] text-muted-foreground">
                  {FEATURES[key].module}
                </span>
              </td>
              {PLAN_ORDER.map((id) => (
                <td key={id} className={td}>
                  {planAllows(id, key) ? (
                    <Chip tone="success">Yes</Chip>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableFrame>
    </SurfacePage>
  );
}

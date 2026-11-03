"use client";

// Development-only visual check for the upgrade window, with sample data.
// Nothing here talks to a server. Pick a scene with ?scene=<name>.
import { useEffect, useState } from "react";
import type { BillingInterval, PlanId } from "@/lib/billing/catalog";
import {
  asPlan,
  freeNudge,
  nextPlan,
  suggestedPlan,
  type BillingBlock,
} from "@/lib/billing/present";
import { FreeCreditStripView, FreeSidebarCardView, LockedFeaturesView } from "./FreePlanPushes";
import { UpgradeWindow, type UpgradeView } from "./UpgradeScreen";
import { BrandLimitCardView } from "./BrandLimitCard";

const SCENES = [
  "plans",
  "feature",
  "limit",
  "credits",
  "empty",
  "member",
  "paid",
  "confirm",
  "sent",
  "loading",
  "pushes",
  "brands",
  "brands-window",
] as const;
type Scene = (typeof SCENES)[number];

const BLOCKS: Partial<Record<Scene, BillingBlock>> = {
  feature: { code: "upgrade_required", feature: "campaigns", requiredPlan: "growth" },
  limit: { code: "limit_reached", limit: "competitors", used: 3, max: 3 },
  "brands-window": { code: "limit_reached", limit: "brands", used: 1, max: 1 },
  credits: { code: "insufficient_balance", meter: "credits", needed: 140, available: 35 },
  // Free and out of credits: the real window shows plans first.
  empty: { code: "insufficient_balance", meter: "credits", needed: 12, available: 0 },
};

export function UpgradeLab() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [view, setView] = useState<UpgradeView>("plans");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [last, setLast] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("scene") as Scene | null;
    const next = fromUrl && SCENES.includes(fromUrl) ? fromUrl : "plans";
    setScene(next);
    setView(next === "credits" ? "credits" : "plans");
  }, []);

  const block = (scene && BLOCKS[scene]) ?? null;
  const current: PlanId = asPlan(
    scene === "limit" || scene === "brands-window" ? "starter" : scene === "paid" ? "growth" : "",
  );
  const recommended = block
    ? suggestedPlan(block, current)
    : current === "free"
      ? "growth"
      : nextPlan(current);

  return (
    <main
      data-testid="upgrade-lab-frame"
      data-ready={scene !== null}
      data-last={last}
      className="min-h-dvh bg-background"
    >
      {scene === "pushes" && (
        <div className="mx-auto flex max-w-[720px] flex-col gap-6 p-6">
          {[64, 16, 0].map((credits) => {
            const nudge = freeNudge({ credits, nextExpiry: null });
            return (
              <div key={credits} className="flex flex-wrap items-start gap-4">
                <FreeSidebarCardView
                  credits={credits}
                  nudge={nudge}
                  className="w-[248px]"
                  onUpgrade={() => setLast(`upgrade:${credits}`)}
                />
                {nudge && (
                  <FreeCreditStripView
                    nudge={nudge}
                    onUpgrade={() => setLast(`plans:${credits}`)}
                    onDismiss={() => setLast("dismiss")}
                  />
                )}
              </div>
            );
          })}
          <LockedFeaturesView
            locked={[
              { feature: "autopilot", plan: "starter" },
              { feature: "ugc", plan: "starter" },
              { feature: "audience", plan: "starter" },
              { feature: "competitors", plan: "starter" },
            ]}
            onPick={(feature) => setLast(`feature:${feature}`)}
          />
        </div>
      )}
      {scene === "brands" && (
        // The Projects page's website bar sits on a dark sky.
        <div className="dark mx-auto flex max-w-xl flex-col gap-6 bg-[#0b1220] p-6 text-foreground">
          <BrandLimitCardView
            plan="starter"
            max={1}
            usedBy={["acme.com"]}
            wanted="newbrand.com"
            onUpgrade={() => setLast("brands:upgrade")}
            onManage={() => setLast("brands:manage")}
          />
          <BrandLimitCardView
            plan="growth"
            max={3}
            usedBy={["acme.com", "northwind.com", "contoso.io"]}
            wanted="fourth.co"
            onUpgrade={() => setLast("brands:upgrade")}
          />
        </div>
      )}
      {scene && scene !== "pushes" && scene !== "brands" && (
        <UpgradeWindow
          open
          onOpenChange={() => setLast("close")}
          screen={
            scene === "loading"
              ? null
              : {
                  current,
                  block,
                  recommended,
                  view,
                  onViewChange: setView,
                  interval,
                  onIntervalChange: setBillingInterval,
                  canBuy: scene !== "member",
                  paymentsAvailable: scene !== "confirm",
                  busy: null,
                  askSent: last.startsWith("ask:"),
                  balance: scene === "empty" ? 0 : 35,
                  showVideoPacks: current !== "free",
                  onChoose: (item) => {
                    setLast(`choose:${item.kind}:${item.key}:${item.price}`);
                  },
                  onAskOwner: (plan) => setLast(`ask:${plan ?? ""}`),
                }
          }
        />
      )}
    </main>
  );
}

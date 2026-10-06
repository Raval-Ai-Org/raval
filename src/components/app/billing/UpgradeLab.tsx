"use client";

// Development-only visual check for the upgrade window, with sample data.
// Nothing here talks to a server. Pick a scene with ?scene=<name>.
import { useEffect, useState } from "react";
import type { BillingInterval, PlanId } from "@/lib/billing/catalog";
import { asPlan, nextPlan, suggestedPlan, type BillingBlock } from "@/lib/billing/present";
import { UpgradeWindow, type UpgradeChoice, type UpgradeView } from "./UpgradeScreen";

const SCENES = [
  "plans",
  "feature",
  "limit",
  "credits",
  "member",
  "paid",
  "confirm",
  "sent",
  "loading",
] as const;
type Scene = (typeof SCENES)[number];

const BLOCKS: Partial<Record<Scene, BillingBlock>> = {
  feature: { code: "upgrade_required", feature: "autopilot", requiredPlan: "growth" },
  limit: { code: "limit_reached", limit: "competitors", used: 3, max: 3 },
  credits: { code: "insufficient_balance", meter: "credits", needed: 140, available: 35 },
};

const CHOICE: UpgradeChoice = {
  kind: "plan",
  key: "growth",
  label: "Growth plan",
  price: "$1,490 a year",
};

export function UpgradeLab() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [view, setView] = useState<UpgradeView>("plans");
  const [interval, setBillingInterval] = useState<BillingInterval>("year");
  const [pending, setPending] = useState<UpgradeChoice | null>(null);
  const [sent, setSent] = useState<UpgradeChoice | null>(null);
  const [contact, setContact] = useState("");
  const [last, setLast] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("scene") as Scene | null;
    const next = fromUrl && SCENES.includes(fromUrl) ? fromUrl : "plans";
    setScene(next);
    setView(next === "credits" ? "credits" : "plans");
    setPending(next === "confirm" ? CHOICE : null);
    setSent(next === "sent" ? CHOICE : null);
  }, []);

  const block = (scene && BLOCKS[scene]) ?? null;
  const current: PlanId = asPlan(scene === "limit" ? "starter" : scene === "paid" ? "growth" : "");
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
      {scene && (
        <UpgradeWindow
          open
          onOpenChange={() => setLast("close")}
          pending={pending}
          sent={sent}
          contact={contact}
          onContactChange={setContact}
          onBack={() => setPending(null)}
          onSend={() => {
            setSent(pending);
            setPending(null);
          }}
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
                  busy: null,
                  askSent: last.startsWith("ask:"),
                  balance: 35,
                  showVideoPacks: current !== "free",
                  onChoose: (item) => {
                    setLast(`choose:${item.kind}:${item.key}:${item.price}`);
                    setPending(item);
                  },
                  onAskOwner: (plan) => setLast(`ask:${plan ?? ""}`),
                }
          }
        />
      )}
    </main>
  );
}

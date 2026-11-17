// Sample data for the pulse pages in /admin-lab (Overview, Customers, Activity,
// Errors). Built by running the real buildPulse over made-up rows, so the lab
// shows exactly what the pure rules produce. Development only.

import { buildPulse, type PulseInput } from "@/lib/admin/pulse";
import { maskEmail } from "@/lib/admin/permissions";
import type { AdminBalances, AdminPulse } from "@/lib/admin/types";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { LAB_OVERVIEW } from "./AdminLab.fixtures";

const NAMES = [
  "Ayesha Khan",
  "Bilal Ahmed",
  "Sara Malik",
  "Omar Farooq",
  "Hina Raza",
  "Daniyal Shah",
  "Zara Iqbal",
  "Usman Tariq",
  "Maryam Siddiqui",
  "Hamza Qureshi",
  "Fatima Noor",
  "Ali Hassan",
  "Noor Fatima",
  "Saad Javed",
  "Iqra Aslam",
  "Taha Mirza",
  "Laiba Yousaf",
  "Rayan Butt",
  "Amna Sheikh",
  "Fahad Akhtar",
  "Mahnoor Ali",
  "Zain Abbas",
  "Kinza Rehman",
  "Arham Nadeem",
];
const BRANDS = [
  "Chai Corner",
  "Lahore Lifts",
  "Glow Studio",
  "Urban Threads",
  "Bake & Co",
  "Peak Fitness",
  "Saffron Kitchen",
  "Nova Dental",
  "Pixel Plants",
  "Riverside Realty",
  "Mint Cosmetics",
  "Orbit Travel",
];
const ROUTES = [
  "chat.reply",
  "studio.image.brief",
  "studio.carousel",
  "studio.video.storyboard",
  "brand-extract",
  "geo.scan",
  "strategy",
  "campaign.plan",
  "audience.score",
];
const JOB_TYPES = ["image", "carousel", "video", "story"];
const FAILS = [
  "Image model refused the prompt",
  "KIE: out of credits",
  "Timed out waiting for the video",
  "Slide 3 failed the quality check twice",
];
const PLAN_FOR: PlanId[] = [
  "starter",
  "growth",
  "starter",
  "agency",
  "free",
  "starter",
  "growth",
  "free",
];

function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 9301 + 49297) % 233280;
    return value / 233280;
  };
}

export function labPulse(pii: boolean): AdminPulse {
  const now = new Date();
  const rand = seeded(7);
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

  const users: PulseInput["users"] = NAMES.map((name, index) => {
    const email = `${name.split(" ")[0].toLowerCase()}@${BRANDS[index % BRANDS.length].toLowerCase().replace(/[^a-z]/g, "")}.com`;
    return {
      id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name,
      email: pii ? email : maskEmail(email),
      createdAt: minutesAgo(Math.round(rand() * 60 * 24 * 40)),
    };
  });

  const accounts: PulseInput["accounts"] = users
    .map((user, index) => {
      const planId = PLAN_FOR[index % PLAN_FOR.length];
      if (planId === "free") return null;
      const allowance = PLANS[planId].allowances.credits;
      return {
        ownerUserId: user.id,
        planId,
        planLabel: PLANS[planId].label,
        status: "active",
        creditsUnits: Math.round(allowance * (index % 5 === 0 ? 0.05 : 0.2 + rand() * 0.8)),
        allowanceUnits: allowance,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  const workspaces: PulseInput["workspaces"] = users.slice(0, 18).map((user, index) => ({
    id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: BRANDS[index % BRANDS.length] + (index >= BRANDS.length ? " 2" : ""),
    ownerId: user.id,
    createdAt: minutesAgo(Math.round(rand() * 60 * 24 * 25)),
  }));

  const calls: PulseInput["calls"] = [];
  const jobs: PulseInput["jobs"] = [];
  users.forEach((user, index) => {
    if (index % 7 === 6) return; // some people are quiet
    const visits = 1 + Math.floor(rand() * 8);
    for (let v = 0; v < visits; v += 1) {
      const start = Math.round(rand() * 60 * 24 * 13) + (index === 0 ? 0 : 5);
      const steps = 2 + Math.floor(rand() * 12);
      const ws = workspaces[index % workspaces.length];
      for (let s = 0; s < steps; s += 1) {
        const route = ROUTES[Math.floor(rand() * ROUTES.length)];
        calls.push({
          userId: user.id,
          workspaceId: ws.id,
          route,
          status: rand() < 0.04 ? "error" : "ok",
          at: minutesAgo(Math.max(1, start - s * 3)),
        });
      }
      if (rand() < 0.7) {
        const failed = rand() < 0.12;
        jobs.push({
          id: `job-${index}-${v}`,
          userId: user.id,
          workspaceId: ws.id,
          type: JOB_TYPES[Math.floor(rand() * JOB_TYPES.length)],
          title: `${ws.name} post`,
          status: failed ? "failed" : "succeeded",
          error: failed ? { message: FAILS[Math.floor(rand() * FAILS.length)] } : null,
          at: minutesAgo(Math.max(1, start - 2)),
        });
      }
    }
  });

  const pulse = buildPulse({
    now,
    users,
    accounts,
    workspaces,
    calls,
    jobs,
    planOrder: ["starter", "growth", "agency", "scale", "free"],
    planLabels: Object.fromEntries(Object.entries(PLANS).map(([id, plan]) => [id, plan.label])),
  });
  return {
    generatedAt: now.toISOString(),
    truncated: false,
    feed: LAB_OVERVIEW.activity.items,
    ...pulse,
  };
}

export function labBalances(billing: boolean): AdminBalances {
  return {
    fetchedAt: new Date().toISOString(),
    providers: [
      {
        id: "openrouter",
        label: "OpenRouter",
        state: "live",
        balanceUsd: 182.4,
        balanceCredits: null,
        reserveUsd: 140,
        message: "Live balance from OpenRouter.",
        topUpUrl: "https://openrouter.ai/settings/credits",
      },
      {
        id: "kie",
        label: "KIE",
        state: "live",
        balanceUsd: 61.5,
        balanceCredits: 12_300,
        reserveUsd: 95,
        message: "Live credit balance from KIE.",
        topUpUrl: "https://kie.ai/billing",
      },
    ],
    stripe: billing
      ? {
          configured: true,
          livemode: true,
          currency: "usd",
          availableCents: 428_650,
          pendingCents: 96_300,
          byCurrency: [{ currency: "usd", availableCents: 428_650, pendingCents: 96_300 }],
        }
      : null,
  };
}

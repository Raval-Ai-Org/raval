"use client";

// Development-only visual check for the onboarding steps added with goals and
// the product catalogue (ADR-0035): each step with sample data, chosen with
// `?step=`. Nothing here talks to a server; buttons record what they would do.
import { useEffect, useRef, useState } from "react";
import { decideGoals } from "@/lib/goals/decide";
import { firstPostBriefs } from "@/lib/onboarding/flow";
import type { Product, ProductCandidate } from "@/lib/products/catalog";
import type { StudioJob } from "@/lib/studio/jobs";
import { AmbientCanvas } from "./ui";
import { ChannelsStep } from "./ChannelsStep";
import { FirstWinStep, type FirstPostState } from "./FirstWinStep";
import { GoalStep, emptyGoalDraft, type GoalDraft } from "./GoalStep";
import { ManualBrandStep, emptyManualBrand, type ManualBrand } from "./ManualBrandStep";
import { ProductsStep } from "./ProductsStep";
import { ScanStrip } from "./ScanStrip";
import type { ProductDraft } from "./ProductCard";

const WS = "00000000-0000-4000-8000-000000000001";

const swatch = (bg: string, fg: string, label: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${bg}"/><rect x="190" y="120" width="220" height="360" rx="40" fill="${fg}"/><text x="300" y="310" font-family="sans-serif" font-size="34" text-anchor="middle" fill="${bg}">${label}</text></svg>`,
  )}`;

const CANDIDATES: ProductCandidate[] = [
  {
    name: "Cold Brew, 1 L",
    price: "GBP 14",
    description: "",
    category: "",
    url: "https://northwind.example/products/cold-brew",
    images: [swatch("#e8e2d6", "#2b2118", "COLD")],
    source: "shopify",
    fingerprint: "url:northwind.example/products/cold-brew",
  },
  {
    name: "House Espresso Beans",
    price: "GBP 11",
    description: "",
    category: "",
    url: "https://northwind.example/products/espresso",
    images: [swatch("#f1ece4", "#5b3a29", "BEANS")],
    source: "shopify",
    fingerprint: "url:northwind.example/products/espresso",
  },
  {
    name: "Gift Subscription",
    price: "GBP 39",
    description: "",
    category: "",
    url: "https://northwind.example/products/gift",
    images: [],
    source: "shopify",
    fingerprint: "url:northwind.example/products/gift",
  },
];

const PRODUCTS: Product[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "product",
    name: "Cold Brew, 1 L",
    description: "Steeped for 18 hours, bottled the same day.",
    price: "£14",
    url: null,
    category: "Coffee",
    benefits: [],
    images: [{ assetId: "a1", url: swatch("#e8e2d6", "#2b2118", "COLD") }],
    primaryAssetId: "a1",
    source: "shopify",
    position: 0,
    status: "active",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "product",
    name: "House Espresso Beans",
    description: "",
    price: "£11",
    url: null,
    category: "Coffee",
    benefits: [],
    images: [],
    primaryAssetId: null,
    source: "manual",
    position: 1,
    status: "active",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    kind: "service",
    name: "Office coffee service",
    description: "Weekly beans and a machine for teams of 10 to 50.",
    price: "",
    url: null,
    category: "",
    benefits: [],
    images: [],
    primaryAssetId: null,
    source: "manual",
    position: 2,
    status: "active",
  },
];

const GOALS = (() => {
  const d = decideGoals(
    {
      focus: "followers",
      targets: [{ metric: "followers", platform: "instagram", target: 5000, baseline: 1200 }],
      timeframeWeeks: 12,
      postsPerWeek: 4,
      channels: ["instagram", "tiktok"],
    },
    new Date("2026-11-01T00:00:00Z"),
  );
  return d.ok ? d.goals : null;
})();

const job = (n: number, status: StudioJob["status"], body: string): StudioJob =>
  ({
    id: `job-${n}`,
    status,
    output: {
      variants: body
        ? [{ platform: "instagram", title: "", body, hashtags: [], chars: body.length }]
        : [],
    },
  }) as unknown as StudioJob;

export function OnboardingLab() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState("goals");
  const [last, setLast] = useState("");
  const [goal, setGoal] = useState<GoalDraft>({
    ...emptyGoalDraft,
    focus: "followers",
    channels: ["instagram"],
  });
  const [manual, setManual] = useState<ManualBrand>(emptyManualBrand);
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStep(params.get("step") ?? "goals");
    if (params.get("empty") === "1") setProducts([]);
    setReady(true);
  }, []);

  const record = (what: string) => () => setLast(what);
  const briefs = firstPostBriefs({
    workspaceId: WS,
    brandName: "Northwind",
    goals: GOALS,
    product: PRODUCTS[0],
    platform: "instagram",
  });
  const postStates: Record<string, Record<number, FirstPostState>> = {
    first: {},
    "first-running": {
      1: {
        status: "succeeded",
        job: job(
          1,
          "succeeded",
          "18 hours. That's how long our cold brew steeps before it meets a bottle.\n\nSave this for the next hot morning.",
        ),
      },
      2: { status: "running", job: job(2, "running", "") },
      3: { status: "starting" },
    },
    "first-failed": {
      1: { status: "failed", error: "This post didn't finish. Try again." },
      2: { status: "idle" },
      3: { status: "idle" },
    },
  };

  return (
    <div
      data-mellox-app
      data-testid="onboarding-lab-frame"
      data-ready={ready}
      className="relative min-h-dvh overflow-x-clip bg-background text-foreground"
    >
      <AmbientCanvas />
      <p data-testid="lab-last" className="sr-only">
        {last}
      </p>
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
        {step === "goals" && (
          <div className="mx-auto max-w-3xl">
            <GoalStep
              draft={goal}
              saving={false}
              error={null}
              warnings={[]}
              reduce
              headingRef={headingRef}
              scanStrip={
                <ScanStrip
                  url="https://northwind.example"
                  status="loading"
                  progress={{ stage: "search", message: "", pct: 62 }}
                  phase={2}
                  discoveries={{}}
                  reduce
                  onRetry={record("retry")}
                />
              }
              onChange={(patch) => setGoal((g) => ({ ...g, ...patch }))}
              onBack={record("back")}
              onContinue={record("goals:continue")}
            />
          </div>
        )}
        {step === "manual" && (
          <div className="mx-auto max-w-xl">
            <ManualBrandStep
              value={manual}
              headingRef={headingRef}
              onChange={(p) => setManual((m) => ({ ...m, ...p }))}
              onBack={record("back")}
              onContinue={record("manual:continue")}
            />
          </div>
        )}
        {step === "products" && (
          <ProductsStep
            brandName="Northwind"
            candidates={products.length ? CANDIDATES : []}
            products={products}
            loading={false}
            importing={false}
            busy={{}}
            lowResolution={{ [PRODUCTS[0].id]: true }}
            adding={false}
            error={null}
            blockedReason={
              products.length
                ? null
                : "Add at least one product or service so Mellox has something real to write about."
            }
            reduce
            headingRef={headingRef}
            onImport={record("import")}
            onDismissCandidates={record("dismiss")}
            onAdd={(d: ProductDraft) => {
              setLast(`add:${d.kind}:${d.name}`);
              setProducts((list) => [
                ...list,
                {
                  ...PRODUCTS[2],
                  id: `new-${list.length}`,
                  kind: d.kind,
                  name: d.name,
                  description: d.description,
                  price: d.price,
                },
              ]);
            }}
            onSave={(id) => setLast(`save:${id}`)}
            onArchive={(id) => setProducts((list) => list.filter((p) => p.id !== id))}
            onUpload={(id) => setLast(`upload:${id}`)}
            onPrimary={(id) => setLast(`primary:${id}`)}
            onBack={record("back")}
            onContinue={record("products:continue")}
          />
        )}
        {step === "channels" && (
          <div className="mx-auto max-w-3xl">
            <ChannelsStep
              connectedCount={0}
              headingRef={headingRef}
              onBack={record("back")}
              onContinue={record("channels:continue")}
            >
              <p className="ds-well rounded-[var(--ds-radius-tile)] px-4 py-6 text-center text-[13px] text-muted-foreground">
                The connect tiles come from the live publishing provider.
              </p>
            </ChannelsStep>
          </div>
        )}
        {step.startsWith("first") && (
          <FirstWinStep
            brandName="Northwind"
            goalLine="Grow my following: 1,200 → 5,000 Instagram followers by 24 Jan"
            briefs={briefs}
            products={PRODUCTS}
            productId={PRODUCTS[0].id}
            platform="instagram"
            platforms={["instagram", "tiktok"]}
            priceLabel="6 credits"
            posts={postStates[step] ?? {}}
            billing={
              step === "first-failed"
                ? {
                    message:
                      "Your plan has run out of credits for new posts. You can finish setup and add more later.",
                    href: "/pricing",
                  }
                : null
            }
            reduce
            headingRef={headingRef}
            onProduct={(id) => setLast(`product:${id}`)}
            onPlatform={(id) => setLast(`platform:${id}`)}
            onStart={record("first:start")}
            onRetry={(n) => setLast(`retry:${n}`)}
            onBack={record("back")}
            onLibrary={record("library")}
            onEnter={record("enter")}
          />
        )}
      </main>
    </div>
  );
}

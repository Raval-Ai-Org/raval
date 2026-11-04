"use client";

// Development-only visual check for the onboarding steps added with goals and
// the product catalogue (ADR-0035): each step with sample data, chosen with
// `?step=`. Nothing here talks to a server; buttons record what they would do.
import { useEffect, useRef, useState } from "react";
import type { Product, ProductCandidate } from "@/lib/products/catalog";
import { AmbientCanvas } from "./ui";
import { ChannelsStep } from "./ChannelsStep";
import { FinishStep } from "./FinishStep";
import { GoalStep, emptyGoalDraft, type GoalDraft } from "./GoalStep";
import { ManualBrandStep, emptyManualBrand, type ManualBrand } from "./ManualBrandStep";
import { ProductsStep } from "./ProductsStep";
import { ScanStrip } from "./ScanStrip";
import type { ProductDraft } from "./ProductCard";
import { LanguageStep } from "./LanguageStep";
import { VisorTransition, type Beat } from "@/components/brand/mox/VisorTransition";

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

export function OnboardingLab() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState("goals");
  const [last, setLast] = useState("");
  const [language, setLanguage] = useState("English");
  const [entering, setEntering] = useState(false);
  // `?step=finish&beat=glow`: hold the VR entry on one beat.
  const [beat, setBeat] = useState<Beat | null>(null);
  const [goal, setGoal] = useState<GoalDraft>({
    ...emptyGoalDraft,
    focus: "followers",
    channels: ["instagram"],
  });
  const [manual, setManual] = useState<ManualBrand>(emptyManualBrand);
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [incoming, setIncoming] = useState<ProductCandidate[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setStep(params.get("step") ?? "goals");
    setBeat((params.get("beat") as Beat | null) ?? null);
    if (params.get("empty") === "1") setProducts([]);
    // `?saving=1`: what the scan found is still being kept.
    if (params.get("saving") === "1") {
      setProducts(PRODUCTS.slice(0, 1));
      setIncoming(CANDIDATES.slice(1));
    }
    setReady(true);
  }, []);

  const record = (what: string) => () => setLast(what);

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
                  discoveries={{ products: { products: CANDIDATES } }}
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
            siteHost="northwind.example"
            scanning={false}
            incoming={incoming}
            failed={[]}
            products={products}
            loading={false}
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
            onRetry={record("retry")}
            onRemoveFound={() => setProducts((list) => list.filter((p) => p.source === "manual"))}
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
        {step === "language" && (
          <div className="mx-auto max-w-3xl">
            <LanguageStep
              value={language}
              onChange={(l) => {
                setLanguage(l);
                setLast(`language:${l}`);
              }}
              onBack={record("back")}
              onContinue={record("language:continue")}
            />
          </div>
        )}
        {/* `?step=finish`: press and hold plays the VR entry, then says so. */}
        {(step === "finish" || step === "first") && (
          <div className="mx-auto max-w-3xl py-6">
            <FinishStep
              brandName="Northwind"
              language={language}
              products={PRODUCTS.length}
              channels={1}
              headingRef={headingRef}
              onBack={record("back")}
              onEnter={() => setEntering(true)}
            />
          </div>
        )}
      </main>
      {(entering || beat) && (
        <VisorTransition
          freeze={beat ?? undefined}
          onCovered={() => {
            setEntering(false);
            setLast("entered");
          }}
        />
      )}
    </div>
  );
}

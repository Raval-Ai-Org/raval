"use client";

// Development-only: every onboarding screen in the one-question stage
// (ADR-0049) with sample data, chosen with `?step=` (website, manual, ask,
// review, audience, products, language, done). Nothing here talks to a
// server; buttons record what they would do.
import { useEffect, useRef, useState } from "react";
import type { Product, ProductCandidate } from "@/lib/products/catalog";
import { ManualBrandStep, emptyManualBrand, type ManualBrand } from "./ManualBrandStep";
import type { InspoItem } from "./manual/use-manual-inspiration";
import { MANUAL_PARTS, type ManualPart } from "@/lib/onboarding/manual-brand";
import { ProductsStep } from "./ProductsStep";
import type { ProductDraft } from "./ProductCard";
import { AskLab, ASK_LAB_STEPS, type LabSlot } from "./ask/AskLab";
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

/** Screens the one-question flow replaced, and where they went. */
const LEGACY_STEPS: Record<string, { step: string; id?: string }> = {
  goals: { step: "ask", id: "focus" },
  channels: { step: "ask", id: "channels" },
  finish: { step: "done" },
  first: { step: "done" },
};

export function OnboardingLab() {
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState("website");
  const [last, setLast] = useState("");
  // `?step=finish&beat=glow`: hold the VR entry on one beat.
  const [beat, setBeat] = useState<Beat | null>(null);
  const [manual, setManual] = useState<ManualBrand>(emptyManualBrand);
  const [manualPart, setManualPart] = useState<ManualPart>("basics");
  const [inspo, setInspo] = useState<InspoItem[]>([]);
  const [products, setProducts] = useState<Product[]>(PRODUCTS);
  const [incoming, setIncoming] = useState<ProductCandidate[]>([]);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // Older screen names land on the screen that replaced them.
    const asked = params.get("step") ?? "website";
    const moved = LEGACY_STEPS[asked];
    if (moved) {
      if (moved.id) params.set("id", moved.id);
      params.set("step", moved.step);
      window.history.replaceState(null, "", `?${params.toString()}`);
    }
    const next = moved?.step ?? asked;
    setStep((ASK_LAB_STEPS as readonly string[]).includes(next) ? next : "website");
    const part = params.get("part") as ManualPart | null;
    if (part && MANUAL_PARTS.includes(part)) {
      setManualPart(part);
      setManual({
        ...emptyManualBrand,
        brandName: "Northwind Coffee",
        oneLiner: "Small-batch coffee roasted in Leeds, delivered weekly",
        industry: "Food & drink",
        audience: "Busy professionals who care where their coffee comes from",
        voice: ["friendly", "expert"],
        colors: ["#1F3B2D", "#C8F169", "#F4F1EA"],
        competitors: [{ name: "Bean Bros", url: "https://beanbros.example" }],
      });
      setInspo([
        {
          key: "i1",
          label: "cold.png",
          preview: swatch("#e8e2d6", "#2b2118", "COLD"),
          link: null,
          status: "done",
        },
        {
          key: "i2",
          label: "beans.png",
          preview: swatch("#f1ece4", "#5b3a29", "BEANS"),
          link: null,
          status: "uploading",
        },
        {
          key: "i3",
          label: "instagram.com",
          preview: null,
          link: "https://instagram.com/p/x",
          status: "error",
          error: "We couldn't download this link.",
        },
      ]);
    }
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

  const slot: LabSlot | undefined =
    step === "manual"
      ? {
          scan: false,
          action: null,
          node: (
            <ManualBrandStep
              value={manual}
              part={manualPart}
              inspirations={inspo}
              reduce
              headingRef={headingRef}
              onChange={(p) => setManual((m) => ({ ...m, ...p }))}
              onPart={(part) => {
                setManualPart(part);
                setLast(`part:${part}`);
              }}
              onAddInspoFiles={(files) => {
                setInspo((list) => [
                  ...list,
                  ...files.map((f, i) => ({
                    key: `f${list.length + i}`,
                    label: f.name,
                    preview: URL.createObjectURL(f),
                    link: null,
                    status: "done" as const,
                  })),
                ]);
                return null;
              }}
              onAddInspoLink={(url) => {
                setInspo((list) => [
                  ...list,
                  { key: `l${list.length}`, label: url, preview: null, link: url, status: "done" },
                ]);
                return null;
              }}
              onRemoveInspo={(key) => setInspo((list) => list.filter((i) => i.key !== key))}
              onRetryInspo={record("inspo:retry")}
              onHaveWebsite={record("back")}
              onDone={record("manual:continue")}
            />
          ),
        }
      : step === "products"
        ? {
            scan: true,
            action: {
              label: "Continue",
              onClick: record("products:continue"),
              disabled: !products.length,
              hint: products.length
                ? null
                : "Add at least one product or service so Mellox has something real to write about.",
            },
            node: (
              <div className="mx-auto max-w-5xl">
                <ProductsStep
                  embedded
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
                  onRemoveFound={() =>
                    setProducts((list) => list.filter((p) => p.source === "manual"))
                  }
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
              </div>
            ),
          }
        : undefined;

  // Every screen is the one-question stage (ADR-0049), as in the real flow.
  return (
    <div data-testid="onboarding-lab-frame" data-ready={ready}>
      <p data-testid="lab-last" className="sr-only">
        {last}
      </p>
      {ready && <AskLab key={step} step={step} slot={slot} onLast={setLast} />}
      {beat && <VisorTransition freeze={beat} onCovered={() => setLast("entered")} />}
    </div>
  );
}

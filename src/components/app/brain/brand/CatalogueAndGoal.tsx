"use client";

// Brain → Brand → Products and Goal (ADR-0035): the same catalogue and goal
// a person set in onboarding, editable any time. Writes go through
// src/server/fns/products.ts and src/server/fns/goals.ts.
import { useEffect, useRef, useState } from "react";
import { ShoppingBag, Target } from "@/components/icons";
import { Catalogue } from "@/components/onboarding/ProductsStep";
import {
  GoalStep,
  emptyGoalDraft,
  goalDraftFrom,
  goalDraftToRaw,
  type GoalDraft,
} from "@/components/onboarding/GoalStep";
import { useOnboardingProducts } from "@/components/onboarding/use-onboarding-products";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import type { BrandDna } from "@/hooks/use-brand-dna";
import { getGoals, saveGoals } from "@/lib/goals.functions";
import { goalLine } from "@/lib/goals/decide";
import type { WorkspaceGoals } from "@/lib/goals/contracts";
import { listProducts } from "@/lib/products.functions";
import { productsSummary, type Product } from "@/lib/products/catalog";
import { toast } from "@/lib/toast";

/* ── previews on the tile grid ── */

export function ProductsPreview({ workspaceId }: { workspaceId: string | null | undefined }) {
  const [products, setProducts] = useState<Product[] | null>(null);
  useEffect(() => {
    if (!workspaceId) return;
    listProducts({ data: { workspaceId } })
      .then(setProducts)
      .catch(() => setProducts([]));
  }, [workspaceId]);
  const photos = (products ?? []).flatMap((p) => p.images.slice(0, 1)).slice(0, 3);
  if (products && !products.length)
    return (
      <div className="grid h-full place-items-center text-[12.5px] text-muted-foreground">
        <div className="flex flex-col items-center gap-2">
          <ShoppingBag className="h-6 w-6 opacity-50" />
          <span>Add what you sell</span>
        </div>
      </div>
    );
  return (
    <div className="flex h-full flex-col gap-3">
      {photos.length > 0 && (
        <div className="flex gap-2">
          {photos.map((img) => (
            <span
              key={img.assetId}
              className="h-14 w-14 overflow-hidden rounded-xl bg-secondary/40 ring-1 ring-border/60"
            >
              {img.url && <img src={img.url} alt="" className="h-full w-full object-contain" />}
            </span>
          ))}
        </div>
      )}
      <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/85">
        {products ? productsSummary(products) : "…"}
      </p>
    </div>
  );
}

export function GoalPreview({ workspaceId }: { workspaceId: string | null | undefined }) {
  const [goals, setGoals] = useState<WorkspaceGoals | null | undefined>(undefined);
  useEffect(() => {
    if (!workspaceId) return;
    getGoals({ data: { workspaceId } })
      .then((v) => setGoals(v.goals))
      .catch(() => setGoals(null));
  }, [workspaceId]);
  return (
    <div className="flex h-full flex-col gap-2">
      <Target className="h-5 w-5 text-primary" />
      <p className="line-clamp-3 text-[13px] leading-relaxed text-foreground/85">
        {goals === undefined ? "…" : goals ? goalLine(goals) : "Set what your marketing is for"}
      </p>
    </div>
  );
}

/* ── editors ── */

/**
 * The catalogue. Brand DNA's `products` line follows it while that line still
 * says what Mellox wrote last (or is empty); a line a person wrote by hand stays.
 */
export function ProductsEditor({
  workspaceId,
  dna,
  save,
}: {
  workspaceId: string;
  dna: BrandDna;
  save: (patch: Partial<BrandDna>) => void;
}) {
  const reduce = useReducedMotionSafe();
  const c = useOnboardingProducts(workspaceId);
  const written = useRef<string | null>(null);
  useEffect(() => {
    if (c.loading) return;
    const summary = productsSummary(c.products);
    if (written.current === null) {
      written.current = summary;
      if (!dna.products.trim() && summary) save({ products: summary });
      return;
    }
    if (summary !== written.current && (!dna.products.trim() || dna.products === written.current))
      save({ products: summary });
    written.current = summary;
  }, [c.loading, c.products, dna.products, save]);

  return (
    <div>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        Posts about a product use its real photo and only the facts here. Labels and packaging are
        never redrawn.
      </p>
      <Catalogue
        className="mt-5"
        products={c.products}
        loading={c.loading}
        busy={c.busy}
        lowResolution={c.lowResolution}
        adding={c.adding}
        reduce={reduce}
        showEmpty
        onAdd={(d) => void c.add(d)}
        onSave={(id, d) => void c.save(id, d)}
        onArchive={(id) => void c.archive(id)}
        onUpload={(id, file) => void c.upload(id, file)}
        onPrimary={(id, assetId) => void c.setPrimary(id, assetId)}
      />
      {c.error && (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-destructive/[0.07] px-4 py-3 text-[13px] text-destructive"
        >
          {c.error}
        </p>
      )}
    </div>
  );
}

export function GoalEditor({ workspaceId }: { workspaceId: string }) {
  const reduce = useReducedMotionSafe();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState<GoalDraft>(emptyGoalDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  useEffect(() => {
    getGoals({ data: { workspaceId } })
      .then((v) => v.goals && setDraft(goalDraftFrom(v.goals)))
      .catch(() => undefined);
  }, [workspaceId]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveGoals({ data: { workspaceId, goals: goalDraftToRaw(draft) } });
      setWarnings(saved.warnings.map((w) => w.message));
      toast.success("Goal saved", {
        description: "Your next posts, the strategy and Autopilot follow it.",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your goal. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <GoalStep
      compact
      submitLabel="Save goal"
      draft={draft}
      saving={saving}
      error={error}
      warnings={warnings}
      reduce={reduce}
      headingRef={headingRef}
      onChange={(patch) => {
        setError(null);
        setDraft((d) => ({ ...d, ...patch }));
      }}
      onContinue={() => void submit()}
    />
  );
}

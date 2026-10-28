"use client";

import { useState, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Plus,
  ShoppingBag,
  Spinner,
  Wrench,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import type { Product, ProductCandidate, ProductKind } from "@/lib/products/catalog";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProductCard, ProductForm, draftFrom, type ProductDraft } from "./ProductCard";
import { Eyebrow } from "./ui";

export type ProductsStepProps = {
  brandName: string;
  /** What the scan found and the person hasn't kept or dropped yet. */
  candidates: ProductCandidate[];
  products: Product[];
  loading: boolean;
  importing: boolean;
  /** Product id → busy (saving, uploading). */
  busy: Record<string, boolean>;
  lowResolution: Record<string, boolean>;
  adding: boolean;
  error: string | null;
  blockedReason: string | null;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onImport: (candidates: ProductCandidate[]) => void;
  onDismissCandidates: () => void;
  onAdd: (draft: ProductDraft) => void;
  onSave: (id: string, draft: ProductDraft) => void;
  onArchive: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPrimary: (id: string, assetId: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

export function ProductsStep(p: ProductsStepProps) {
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(p.candidates.map((c) => c.fingerprint)),
  );
  const showCandidates = p.candidates.length > 0;
  const enter = {
    initial: p.reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: { duration: duration.medium, ease: ease.emphasized },
  };
  const toggle = (fp: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(fp)) next.delete(fp);
      else next.add(fp);
      return next;
    });

  return (
    <div>
      <Eyebrow icon={ShoppingBag}>What you sell</Eyebrow>
      <h1
        ref={p.headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        {p.products.length || showCandidates
          ? `What ${p.brandName || "you"} sells`
          : `What does ${p.brandName || "your brand"} sell?`}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Mellox writes about real products, with your real photos. Labels, text and packaging stay
        exactly as they are in the picture.
      </p>

      <AnimatePresence initial={false}>
        {showCandidates && (
          <motion.section {...enter} aria-labelledby="found-products" className="mt-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p id="found-products" className="ds-label">
                  Found on your site
                </p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  Untick anything you don&rsquo;t want Mellox to post about.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={p.onDismissCandidates}
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
                >
                  Skip these
                </button>
                <button
                  type="button"
                  disabled={!picked.size || p.importing}
                  onClick={() => p.onImport(p.candidates.filter((c) => picked.has(c.fingerprint)))}
                  className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
                >
                  {p.importing ? (
                    <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Check className="h-3.5 w-3.5" aria-hidden />
                  )}
                  {p.importing ? "Saving photos…" : `Keep ${picked.size}`}
                </button>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
              {p.candidates.map((c) => {
                const on = picked.has(c.fingerprint);
                return (
                  <li key={c.fingerprint}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(c.fingerprint)}
                      disabled={p.importing}
                      className={cn(
                        "ds-tile relative flex w-full flex-col overflow-hidden text-left transition-[border-color,box-shadow]",
                        on
                          ? "border-primary/60 shadow-[0_0_0_3px_hsl(var(--primary)/0.12)]"
                          : "opacity-60 hover:opacity-90",
                      )}
                    >
                      <span className="block aspect-square w-full bg-[var(--ds-well-bg)]">
                        {c.images[0] ? (
                          <img
                            src={c.images[0]}
                            alt=""
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            className="h-full w-full object-contain p-2"
                          />
                        ) : (
                          <span className="grid h-full place-items-center text-muted-foreground">
                            <ShoppingBag className="h-6 w-6" aria-hidden />
                          </span>
                        )}
                      </span>
                      <span className="block p-2.5">
                        <span className="line-clamp-2 text-[12.5px] font-medium leading-snug">
                          {c.name}
                        </span>
                        {c.price && (
                          <span className="mt-0.5 block text-[11.5px] tabular-nums text-muted-foreground">
                            {c.price}
                          </span>
                        )}
                      </span>
                      <span
                        aria-hidden
                        className={cn(
                          "absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full border transition-colors",
                          on
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border bg-card",
                        )}
                      >
                        {on && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.section>
        )}
      </AnimatePresence>

      <Catalogue
        className="mt-9"
        products={p.products}
        loading={p.loading}
        busy={p.busy}
        lowResolution={p.lowResolution}
        adding={p.adding}
        reduce={p.reduce}
        showEmpty={!showCandidates}
        onAdd={p.onAdd}
        onSave={p.onSave}
        onArchive={p.onArchive}
        onUpload={p.onUpload}
        onPrimary={p.onPrimary}
      />

      {p.error && (
        <p
          role="alert"
          className="mt-5 rounded-2xl bg-destructive/[0.07] px-4 py-3 text-[13px] text-destructive"
        >
          {p.error}
        </p>
      )}

      <div className="mt-9 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={p.onBack}
          className={cn(dsGhostBtn, "h-11 px-4 text-[13.5px]")}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> Back
        </button>
        <div className="flex flex-col items-end gap-1.5">
          <button
            type="button"
            disabled={Boolean(p.blockedReason)}
            onClick={p.onContinue}
            className={cn(dsPrimaryBtn, "h-12 px-6 text-[14.5px]")}
          >
            Continue <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
          {p.blockedReason && (
            <p className="max-w-xs text-right text-[12px] text-muted-foreground">
              {p.blockedReason}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export type CatalogueProps = {
  products: Product[];
  loading: boolean;
  busy: Record<string, boolean>;
  lowResolution: Record<string, boolean>;
  adding: boolean;
  reduce: boolean;
  /** Show the "add the first thing you sell" panel when the list is empty. */
  showEmpty: boolean;
  className?: string;
  onAdd: (draft: ProductDraft) => void;
  onSave: (id: string, draft: ProductDraft) => void;
  onArchive: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPrimary: (id: string, assetId: string) => void;
};

/** The brand's products and services as cards, with add, edit and photo upload. */
export function Catalogue({ className, ...p }: CatalogueProps) {
  const [formKind, setFormKind] = useState<ProductKind | null>(null);
  const enter = {
    initial: p.reduce ? { opacity: 0 } : { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: { duration: duration.medium, ease: ease.emphasized },
  };
  return (
    <section aria-labelledby="your-products" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="your-products" className="ds-label">
          Your catalogue{p.products.length ? ` · ${p.products.length}` : ""}
        </p>
        {!formKind && (p.products.length > 0 || !p.showEmpty) && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setFormKind("product")}
              className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Product
            </button>
            <button
              type="button"
              onClick={() => setFormKind("service")}
              className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden /> I sell a service
            </button>
          </div>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false}>
          {formKind && (
            <motion.li key="new" {...enter} className="ds-tile p-3.5">
              <p className="mb-3 text-[13px] font-semibold">
                {formKind === "service" ? "Add a service" : "Add a product"}
              </p>
              <ProductForm
                initial={draftFrom(null, formKind)}
                saving={p.adding}
                onCancel={() => setFormKind(null)}
                onSave={(d) => {
                  p.onAdd(d);
                  setFormKind(null);
                }}
              />
            </motion.li>
          )}
          {p.products.map((product) => (
            <motion.li key={product.id} layout={!p.reduce} {...enter}>
              <ProductCard
                product={product}
                busy={Boolean(p.busy[product.id])}
                lowResolution={p.lowResolution[product.id]}
                onSave={(d) => p.onSave(product.id, d)}
                onArchive={() => p.onArchive(product.id)}
                onUpload={(file) => p.onUpload(product.id, file)}
                onPrimary={(assetId) => p.onPrimary(product.id, assetId)}
              />
            </motion.li>
          ))}
        </AnimatePresence>
        {p.loading &&
          !p.products.length &&
          [0, 1].map((i) => (
            <li key={i} className="ds-tile aspect-[4/5] animate-pulse bg-[var(--ds-well-bg)]" />
          ))}
        {!p.loading && !p.products.length && !formKind && p.showEmpty && (
          <li className="min-[460px]:col-span-2 lg:col-span-3">
            <div className="ds-well flex flex-col items-center gap-3 rounded-[var(--ds-radius-tile)] px-6 py-10 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
                <ShoppingBag className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-[14px] font-medium">Add the first thing you sell</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">
                One is enough to start. Your first posts will be about it.
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setFormKind("product")}
                  className={cn(dsPrimaryBtn, "h-10 px-4 text-[13px]")}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add a product
                </button>
                <button
                  type="button"
                  onClick={() => setFormKind("service")}
                  className={cn(dsGhostBtn, "h-10 px-4 text-[13px]")}
                >
                  <Wrench className="h-3.5 w-3.5" aria-hidden /> Add a service
                </button>
              </div>
            </div>
          </li>
        )}
      </ul>

      {p.products.some((x) => x.kind === "product" && !x.images.length) && (
        <p className="mt-4 inline-flex items-start gap-2 rounded-2xl bg-primary/[0.06] px-4 py-3 text-[13px] leading-relaxed text-foreground/85">
          <Camera className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
          Add a real photo to each product. Mellox builds the post around it and never redraws the
          product, so labels stay readable.
        </p>
      )}
    </section>
  );
}

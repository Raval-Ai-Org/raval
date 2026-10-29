"use client";

import { useState, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Globe,
  Plus,
  RefreshCw,
  ShoppingBag,
  Spinner,
  Wrench,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import {
  foundLine,
  type Product,
  type ProductCandidate,
  type ProductKind,
} from "@/lib/products/catalog";
import { duration, ease } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ProductCard, ProductForm, draftFrom, type ProductDraft } from "./ProductCard";
import { Eyebrow } from "./ui";

export type ProductsStepProps = {
  brandName: string;
  /** The site the scan read, or null when the brand has none. */
  siteHost: string | null;
  /** True while the scan may still find more. */
  scanning: boolean;
  /** Found on the site and being saved right now. */
  incoming: ProductCandidate[];
  /** Found, but saving failed. */
  failed: ProductCandidate[];
  products: Product[];
  loading: boolean;
  /** Product id → busy (saving, uploading). */
  busy: Record<string, boolean>;
  lowResolution: Record<string, boolean>;
  adding: boolean;
  error: string | null;
  blockedReason: string | null;
  reduce: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  onRetry: () => void;
  onRemoveFound: () => void;
  onAdd: (draft: ProductDraft) => void;
  onSave: (id: string, draft: ProductDraft) => void;
  onArchive: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPrimary: (id: string, assetId: string) => void;
  onBack: () => void;
  onContinue: () => void;
};

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

export function ProductsStep(p: ProductsStepProps) {
  const [filter, setFilter] = useState<ProductKind | "all">("all");
  const found = p.products.filter((x) => x.source !== "manual");
  const services = p.products.filter((x) => x.kind === "service").length;
  const showFilter = services > 0 && services < p.products.length;
  const any = p.products.length > 0 || p.incoming.length > 0;

  return (
    <div>
      <Eyebrow icon={ShoppingBag}>What you sell</Eyebrow>
      <h1
        ref={p.headingRef}
        tabIndex={-1}
        className="mt-4 text-[clamp(1.9rem,4.6vw,2.75rem)] font-semibold leading-[1.05] tracking-[-0.035em] outline-none"
      >
        {any
          ? `What ${p.brandName || "you"} sells`
          : `What does ${p.brandName || "your brand"} sell?`}
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Mellox writes about these, with your real photos. Labels and packaging stay exactly as they
        are.
      </p>

      <FoundBanner
        className="mt-7"
        host={p.siteHost}
        found={found}
        incoming={p.incoming}
        scanning={p.scanning}
        reduce={p.reduce}
        onRemoveFound={p.onRemoveFound}
      />

      <AnimatePresence initial={false}>
        {p.failed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: duration.medium, ease: ease.standard }}
            className="overflow-hidden"
          >
            <div
              role="alert"
              className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-destructive/[0.07] px-4 py-3 text-[13px] text-destructive"
            >
              <span className="inline-flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {plural(p.failed.length, "item")} couldn&rsquo;t be saved.
              </span>
              <button
                type="button"
                onClick={p.onRetry}
                className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Try again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {showFilter && (
        <div
          role="tablist"
          aria-label="Show"
          className="ds-well mt-7 inline-flex rounded-full p-1 text-[12.5px] font-medium"
        >
          {(
            [
              ["all", `All · ${p.products.length}`],
              ["product", `Products · ${p.products.length - services}`],
              ["service", `Services · ${services}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={filter === id}
              onClick={() => setFilter(id)}
              className={cn(
                "relative h-8 rounded-full px-3.5 transition-colors",
                filter === id ? "text-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {filter === id && (
                <motion.span
                  layoutId="products-filter"
                  className="absolute inset-0 rounded-full bg-card shadow-sm"
                  transition={{ duration: p.reduce ? 0 : duration.medium, ease: ease.emphasized }}
                />
              )}
              <span className="relative">{label}</span>
            </button>
          ))}
        </div>
      )}

      <Catalogue
        className={showFilter ? "mt-4" : "mt-8"}
        products={p.products}
        incoming={p.incoming}
        filter={showFilter ? filter : "all"}
        loading={p.loading}
        busy={p.busy}
        lowResolution={p.lowResolution}
        adding={p.adding}
        reduce={p.reduce}
        showEmpty={!p.scanning}
        emptyHint={
          p.siteHost
            ? `We couldn't spot anything for sale on ${p.siteHost}. Add the first thing you sell — one is enough to start.`
            : undefined
        }
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

/**
 * What the scan found, said once at the top: saving with real progress, then
 * a plain count. Nothing here is a decision — removing is on each card.
 */
function FoundBanner({
  host,
  found,
  incoming,
  scanning,
  reduce,
  className,
  onRemoveFound,
}: {
  host: string | null;
  found: Product[];
  incoming: ProductCandidate[];
  scanning: boolean;
  reduce: boolean;
  className?: string;
  onRemoveFound: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const saving = incoming.length > 0;
  const total = found.length + incoming.length;
  const state: "saving" | "looking" | "done" | null = saving
    ? "saving"
    : found.length
      ? "done"
      : scanning && host
        ? "looking"
        : null;
  if (!state) return null;
  const pct = total ? Math.round((found.length / total) * 100) : 0;
  const where = host ? ` on ${host}` : "";

  return (
    <motion.div
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.medium, ease: ease.emphasized }}
      role="status"
      aria-live="polite"
      className={cn(
        "ds-tile relative overflow-hidden px-4 py-3.5",
        state !== "done" && !reduce && "shimmer",
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="relative grid h-10 w-10 shrink-0 place-items-center">
          {state === "done" ? (
            <motion.span
              key="done"
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 22 }}
              className="grid h-10 w-10 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Check className="h-5 w-5" aria-hidden />
            </motion.span>
          ) : (
            <>
              {!reduce && (
                <span className="absolute inset-0 animate-ping rounded-full bg-primary/20 [animation-duration:1.8s]" />
              )}
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-primary/12 text-primary">
                {state === "saving" ? (
                  <Spinner className="h-4.5 w-4.5 animate-spin" aria-hidden />
                ) : (
                  <Globe className="h-4.5 w-4.5" aria-hidden />
                )}
              </span>
            </>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-snug">
            {state === "saving"
              ? `Adding what we found${where}`
              : state === "looking"
                ? `Looking for what you sell${where}`
                : `Found ${foundLine(found)}${where}`}
          </p>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {state === "saving"
              ? `${found.length} of ${total} saved, with their photos`
              : state === "looking"
                ? "They'll appear here by themselves."
                : "Already in your catalogue. Remove anything you don't sell anymore."}
          </p>
        </div>
        {state === "done" && (
          <div className="flex items-center gap-2">
            {confirm ? (
              <>
                <button
                  type="button"
                  onClick={() => setConfirm(false)}
                  className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px]")}
                >
                  Keep them
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirm(false);
                    onRemoveFound();
                  }}
                  className="inline-flex h-8 items-center rounded-full bg-destructive/10 px-3 text-[12.5px] font-medium text-destructive hover:bg-destructive/15"
                >
                  Remove all {found.length}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirm(true)}
                className={cn(dsGhostBtn, "h-8 px-3 text-[12.5px] text-muted-foreground")}
              >
                Remove all
              </button>
            )}
          </div>
        )}
      </div>
      {state === "saving" && (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--ds-well-bg)]">
          <motion.div
            className="h-full rounded-full bg-primary"
            initial={false}
            animate={{ width: `${Math.max(6, pct)}%` }}
            transition={{ duration: reduce ? 0 : duration.slow, ease: ease.standard }}
          />
        </div>
      )}
    </motion.div>
  );
}

/** A found item while its photos are being saved: the real picture, gently shimmering. */
function IncomingCard({ item }: { item: ProductCandidate }) {
  const service = item.kind === "service";
  const KindIcon = service ? Wrench : ShoppingBag;
  return (
    <article className="ds-tile shimmer flex flex-col overflow-hidden" aria-busy="true">
      <div className="relative aspect-[4/3] w-full bg-[var(--ds-well-bg)]">
        {item.images[0] ? (
          <img
            src={item.images[0]}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-contain p-3 opacity-70"
          />
        ) : (
          <span className="grid h-full place-items-center text-muted-foreground/70">
            <KindIcon className="h-7 w-7" aria-hidden />
          </span>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-[11px] font-medium text-foreground/80 backdrop-blur">
          <Spinner className="h-3 w-3 animate-spin text-primary" aria-hidden /> Saving
        </span>
      </div>
      <div className="p-3.5">
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-foreground/80">
          {item.name}
        </p>
        {item.price && (
          <p className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">{item.price}</p>
        )}
      </div>
    </article>
  );
}

export type CatalogueProps = {
  products: Product[];
  /** Found on the site and being saved: shown as cards that fill in. */
  incoming?: ProductCandidate[];
  filter?: ProductKind | "all";
  loading: boolean;
  busy: Record<string, boolean>;
  lowResolution: Record<string, boolean>;
  adding: boolean;
  reduce: boolean;
  /** Show the "add the first thing you sell" panel when the list is empty. */
  showEmpty: boolean;
  /** What the empty panel says (onboarding names the site it read). */
  emptyHint?: string;
  className?: string;
  onAdd: (draft: ProductDraft) => void;
  onSave: (id: string, draft: ProductDraft) => void;
  onArchive: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPrimary: (id: string, assetId: string) => void;
};

/** The brand's products and services as cards, with add, edit and photo upload. */
export function Catalogue({
  className,
  incoming = [],
  filter = "all",
  emptyHint,
  ...p
}: CatalogueProps) {
  const [formKind, setFormKind] = useState<ProductKind | null>(null);
  const shown = filter === "all" ? p.products : p.products.filter((x) => x.kind === filter);
  const waiting =
    filter === "all" ? incoming : incoming.filter((x) => (x.kind ?? "product") === filter);
  const enter = (i: number) => ({
    initial: p.reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: p.reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96 },
    transition: {
      duration: duration.slow,
      ease: ease.emphasized,
      delay: p.reduce ? 0 : Math.min(i, 8) * 0.04,
    },
  });
  const empty = !p.loading && !p.products.length && !incoming.length && !formKind && p.showEmpty;
  return (
    <section aria-labelledby="your-products" className={className}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p id="your-products" className="ds-label">
          Your catalogue{p.products.length ? ` · ${p.products.length}` : ""}
        </p>
        {!formKind && !empty && (
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
              <Wrench className="h-3.5 w-3.5" aria-hidden /> Service
            </button>
          </div>
        )}
      </div>

      <ul className="mt-4 grid grid-cols-1 gap-3 min-[460px]:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence initial={false} mode="popLayout">
          {formKind && (
            <motion.li key="new" layout={!p.reduce} {...enter(0)} className="ds-tile p-3.5">
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
          {shown.map((product, i) => (
            <motion.li key={product.id} layout={!p.reduce} {...enter(i)}>
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
          {waiting.map((item, i) => (
            <motion.li
              key={`incoming:${item.fingerprint}`}
              layout={!p.reduce}
              {...enter(shown.length + i)}
            >
              <IncomingCard item={item} />
            </motion.li>
          ))}
        </AnimatePresence>
        {p.loading &&
          !p.products.length &&
          !incoming.length &&
          [0, 1, 2].map((i) => (
            <li key={i} className="ds-tile shimmer aspect-[4/5] bg-[var(--ds-well-bg)]" />
          ))}
        {empty && (
          <li className="min-[460px]:col-span-2 lg:col-span-3">
            <motion.div
              {...enter(0)}
              className="ds-well flex flex-col items-center gap-3 rounded-[var(--ds-radius-tile)] px-6 py-10 text-center"
            >
              <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
                <ShoppingBag className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-[14px] font-medium">Add the first thing you sell</p>
              <p className="max-w-sm text-[13px] text-muted-foreground">
                {emptyHint ?? "One is enough to start. Your first posts will be about it."}
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
            </motion.div>
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

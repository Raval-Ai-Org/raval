"use client";

import { useState, type Ref } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
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
import { MoxSpeech } from "@/components/app/surface/MoxParts";
import {
  ProductDetail,
  ProductForm,
  ProductRow,
  draftFrom,
  type ProductDraft,
} from "./ProductCard";

export type ProductsStepProps = {
  brandName: string;
  /** Which kind to offer first when the catalogue is empty (a services brand: service). */
  defaultKind?: ProductKind;
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
  /** Inside the one-question shell: Back / Continue live in its dock. */
  embedded?: boolean;
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
      {/* Holo: Mox asks, one line; the heading is for screen readers. */}
      <MoxSpeech pose="face" size={96}>
        {any ? (
          <>
            Check if I got your <b>products right.</b>
          </>
        ) : (
          <>
            What does {p.brandName || "your brand"} <b>sell?</b>
          </>
        )}
      </MoxSpeech>
      <h1 ref={p.headingRef} tabIndex={-1} className="sr-only outline-none">
        {any
          ? `What ${p.brandName || "you"} sells`
          : `What does ${p.brandName || "your brand"} sell?`}
      </h1>

      <FoundBanner
        className="mt-6"
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
          className="ds-well mt-5 inline-flex rounded-full p-1 text-[12.5px] font-medium"
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
        className={showFilter ? "mt-4" : "mt-6"}
        products={p.products}
        incoming={p.incoming}
        filter={showFilter ? filter : "all"}
        loading={p.loading}
        busy={p.busy}
        lowResolution={p.lowResolution}
        adding={p.adding}
        reduce={p.reduce}
        showEmpty={!p.scanning}
        preferKind={p.defaultKind}
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

      <div
        className={cn(
          "mt-9 flex flex-wrap items-center justify-between gap-3",
          p.embedded && "hidden",
        )}
      >
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
              <span className="relative grid h-10 w-10 place-items-center rounded-full bg-primary/12 text-primary-ink">
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
                : "Remove anything you don't sell."}
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

/** A found item while its photos are being saved: a list row, gently shimmering. */
function IncomingRow({ item }: { item: ProductCandidate }) {
  const KindIcon = item.kind === "service" ? Wrench : ShoppingBag;
  return (
    <div className="shimmer flex items-center gap-3 rounded-[16px] p-2" aria-busy="true">
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[var(--ds-well-bg)]">
        {item.images[0] ? (
          <img
            src={item.images[0]}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            className="h-full w-full object-contain p-1 opacity-70"
          />
        ) : (
          <KindIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-snug text-foreground/75">
          {item.name}
        </span>
        <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] text-muted-foreground">
          <Spinner className="h-3 w-3 animate-spin text-primary-ink" aria-hidden /> Saving
        </span>
      </span>
    </div>
  );
}

/** An "add" row at the top of the list (Holo's "Add product manually"). */
function AddRow({ kind, onClick }: { kind: ProductKind; onClick: () => void }) {
  const Icon = kind === "service" ? Wrench : Plus;
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-full p-1.5 pr-3 text-left text-[13px] font-semibold text-foreground/80 transition hover:bg-[var(--ds-card-bg)] hover:text-foreground hover:shadow-[var(--ds-card-shadow)]"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-full border-[1.5px] border-dashed border-[var(--mox-green)]/50 text-[var(--mox-green)] transition-transform group-hover:rotate-90">
        <Icon className="size-3.5" aria-hidden />
      </span>
      {kind === "service" ? "Add a service" : "Add a product"}
    </button>
  );
}

export type CatalogueProps = {
  products: Product[];
  /** Found on the site and being saved: shown as rows that fill in. */
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
  /** The kind offered as the main button when empty. */
  preferKind?: ProductKind;
  className?: string;
  onAdd: (draft: ProductDraft) => void;
  onSave: (id: string, draft: ProductDraft) => void;
  onArchive: (id: string) => void;
  onUpload: (id: string, file: File) => void;
  onPrimary: (id: string, assetId: string) => void;
};

/**
 * The brand's products and services, Holo style: a list on the left (a small
 * thumbnail per row, never an empty photo box) and the chosen one on the
 * right, with its photos, words, edit and remove. Add is a row in the list.
 */
export function Catalogue({
  className,
  incoming = [],
  filter = "all",
  emptyHint,
  preferKind = "product",
  ...p
}: CatalogueProps) {
  const [formKind, setFormKind] = useState<ProductKind | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const shown = filter === "all" ? p.products : p.products.filter((x) => x.kind === filter);
  const waiting =
    filter === "all" ? incoming : incoming.filter((x) => (x.kind ?? "product") === filter);
  const selected = shown.find((x) => x.id === selectedId) ?? shown[0] ?? null;
  const empty = !p.loading && !p.products.length && !incoming.length && !formKind && p.showEmpty;
  const rise = (i: number) => ({
    initial: p.reduce ? { opacity: 0 } : { opacity: 0, x: -8 },
    animate: { opacity: 1, x: 0 },
    exit: p.reduce ? { opacity: 0 } : { opacity: 0, x: -8 },
    transition: {
      duration: duration.medium,
      ease: ease.emphasized,
      delay: p.reduce ? 0 : Math.min(i, 8) * 0.035,
    },
  });

  return (
    <section aria-labelledby="your-products" className={className}>
      <p id="your-products" className="ds-label">
        Your catalogue{p.products.length ? ` · ${p.products.length}` : ""}
      </p>

      {empty ? (
        <motion.div
          {...rise(0)}
          className="ds-well mt-3 flex flex-col items-center gap-3 rounded-[var(--ds-radius-tile)] px-6 py-10 text-center"
        >
          <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary-ink">
            <ShoppingBag className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-[14px] font-semibold">Add the first thing you sell</p>
          <p className="max-w-sm text-[13px] text-muted-foreground">
            {emptyHint ?? "One is enough to start."}
          </p>
          <div
            className={cn(
              "mt-1 flex flex-wrap justify-center gap-2",
              preferKind === "service" && "flex-row-reverse",
            )}
          >
            <button
              type="button"
              onClick={() => setFormKind("product")}
              className={cn(
                preferKind === "service" ? dsGhostBtn : dsPrimaryBtn,
                "h-10 px-4 text-[13px]",
              )}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add a product
            </button>
            <button
              type="button"
              onClick={() => setFormKind("service")}
              className={cn(
                preferKind === "service" ? dsPrimaryBtn : dsGhostBtn,
                "h-10 px-4 text-[13px]",
              )}
            >
              <Wrench className="h-3.5 w-3.5" aria-hidden /> Add a service
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="mt-3 grid min-w-0 gap-3 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] p-1.5">
            <div className="flex flex-col gap-0.5 border-b border-[var(--ds-card-border)] pb-1.5">
              <AddRow kind="product" onClick={() => setFormKind("product")} />
              <AddRow kind="service" onClick={() => setFormKind("service")} />
            </div>
            <ul className="mt-1.5 flex max-h-[260px] flex-col gap-1 overflow-y-auto overscroll-contain scrollbar-thin md:max-h-[380px]">
              <AnimatePresence initial={false}>
                {shown.map((product, i) => (
                  <motion.li key={product.id} layout={!p.reduce} {...rise(i)}>
                    <ProductRow
                      product={product}
                      selected={!formKind && selected?.id === product.id}
                      onSelect={() => {
                        setFormKind(null);
                        setSelectedId(product.id);
                      }}
                    />
                  </motion.li>
                ))}
                {waiting.map((item, i) => (
                  <motion.li
                    key={`incoming:${item.fingerprint}`}
                    layout={!p.reduce}
                    {...rise(shown.length + i)}
                  >
                    <IncomingRow item={item} />
                  </motion.li>
                ))}
              </AnimatePresence>
              {p.loading &&
                !p.products.length &&
                !incoming.length &&
                [0, 1, 2].map((i) => (
                  <li key={i} className="shimmer h-[60px] rounded-[16px] bg-[var(--ds-card-bg)]" />
                ))}
            </ul>
          </div>

          <div className="min-w-0 rounded-[22px] border border-[var(--ds-card-border)] bg-[var(--ds-card-bg)] p-4 shadow-[var(--ds-card-shadow)] sm:p-5 md:self-start">
            {/* Enter-only: an exit that waits could leave the panel blank. */}
            <motion.div
              key={formKind ? `new:${formKind}` : (selected?.id ?? "none")}
              initial={p.reduce ? { opacity: 0 } : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: duration.medium, ease: ease.emphasized }}
            >
              {formKind ? (
                <>
                  <p className="mb-3 text-[15px] font-bold">
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
                </>
              ) : selected ? (
                <ProductDetail
                  key={selected.id}
                  product={selected}
                  busy={Boolean(p.busy[selected.id])}
                  lowResolution={p.lowResolution[selected.id]}
                  onSave={(d) => p.onSave(selected.id, d)}
                  onArchive={() => p.onArchive(selected.id)}
                  onUpload={(file) => p.onUpload(selected.id, file)}
                  onPrimary={(assetId) => p.onPrimary(selected.id, assetId)}
                />
              ) : (
                <div className="grid min-h-[180px] place-items-center text-center text-[13px] text-muted-foreground">
                  {waiting.length ? "Saving what we found…" : "Pick something on the left."}
                </div>
              )}
            </motion.div>
          </div>
        </div>
      )}
    </section>
  );
}

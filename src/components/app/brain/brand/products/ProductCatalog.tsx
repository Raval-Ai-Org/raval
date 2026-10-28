"use client";
// ProductCatalog — the brand's real products in Brain → Brand. Studio puts
// the exact product from here into ads and pictures, so the photo is what a
// person checks first: the main product, then the rest.
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link2, Loader2, Plus, RefreshCw, ShoppingBag, Star, Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { CatalogProduct } from "@/lib/products/catalog";
import { useAddProduct, useDiscoverProducts, useProducts, useUpdateProduct } from "./hooks";

/** The tile on the Brand grid: the first few product photos. */
export function ProductsPreview({ workspaceId }: { workspaceId: string | null }) {
  const { data: products, isLoading } = useProducts(workspaceId);
  if (isLoading)
    return (
      <div className="flex gap-2 p-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="size-14 rounded-xl" />
        ))}
      </div>
    );
  if (!products?.length)
    return (
      <div className="flex h-full flex-col justify-end gap-1 p-4">
        <ShoppingBag className="size-5 text-muted-foreground" />
        <p className="text-[12.5px] text-muted-foreground">
          Add your products so ads show the real thing
        </p>
      </div>
    );
  return (
    <div className="flex h-full flex-col justify-end gap-2 p-4">
      <div className="flex -space-x-3">
        {products.slice(0, 5).map((p) => (
          <span
            key={p.id}
            className="size-14 overflow-hidden rounded-xl bg-[var(--ds-well-bg)] ring-2 ring-background"
          >
            {p.imageUrl ? (
              <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
            ) : null}
          </span>
        ))}
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {products.length} product{products.length === 1 ? "" : "s"}
      </p>
    </div>
  );
}

export function ProductCatalog({
  workspaceId,
  websiteUrl,
}: {
  workspaceId: string | null;
  websiteUrl: string | null;
}) {
  const { data: products, isLoading, isError, refetch } = useProducts(workspaceId);
  const discover = useDiscoverProducts(workspaceId);
  const add = useAddProduct(workspaceId);
  const update = useUpdateProduct(workspaceId);
  const [link, setLink] = useState("");

  const submitLink = () => {
    const raw = link.trim();
    if (!raw) return;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    add.mutate(url, { onSuccess: () => setLink("") });
  };
  const findOnSite = () => {
    if (!websiteUrl) return;
    discover.mutate(/^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex min-w-0 flex-1 items-center">
          <Link2
            aria-hidden
            className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
          />
          <Input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitLink()}
            placeholder="Paste a product page link"
            aria-label="Product page link"
            className="rounded-full pl-9"
            disabled={add.isPending}
          />
        </label>
        <div className="flex gap-2">
          <Button
            onClick={submitLink}
            disabled={!link.trim() || add.isPending}
            className="rounded-full"
          >
            {add.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Plus className="size-4" />
            )}
            Add
          </Button>
          {websiteUrl ? (
            <Button
              variant="outline"
              onClick={findOnSite}
              disabled={discover.isPending}
              className="rounded-full"
            >
              {discover.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              {discover.isPending ? "Reading your site" : "Find on my website"}
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square rounded-[var(--ds-radius-tile)]" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState size="sm" onRetry={() => void refetch()} />
      ) : !products?.length ? (
        <EmptyState
          size="sm"
          icon={ShoppingBag}
          title="No products yet"
          description="Studio puts your real product into ads and pictures instead of inventing one."
          action={
            websiteUrl ? (
              <Button onClick={findOnSite} disabled={discover.isPending} className="rounded-full">
                {discover.isPending ? "Reading your site" : "Find products on my website"}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <motion.ul layout className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <AnimatePresence initial={false}>
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                busy={update.isPending && update.variables?.id === product.id}
                onPrimary={() => update.mutate({ id: product.id, primary: true })}
                onRemove={() => update.mutate({ id: product.id, status: "removed" })}
              />
            ))}
          </AnimatePresence>
        </motion.ul>
      )}
    </div>
  );
}

function ProductCard({
  product,
  busy,
  onPrimary,
  onRemove,
}: {
  product: CatalogProduct;
  busy: boolean;
  onPrimary: () => void;
  onRemove: () => void;
}) {
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "ds-tile group relative overflow-hidden",
        product.isPrimary && "ring-2 ring-primary/70",
      )}
    >
      <div className="aspect-square bg-[var(--ds-well-bg)]">
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <div className="grid size-full place-items-center">
            <ShoppingBag className="size-6 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="space-y-0.5 p-3">
        <p className="truncate text-[13px] font-medium text-foreground" title={product.name}>
          {product.name}
        </p>
        <p className="truncate text-[12px] text-muted-foreground">
          {product.isPrimary ? "Main product" : product.price || " "}
        </p>
      </div>
      <div className="absolute right-2 top-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
        {!product.isPrimary && (
          <button
            type="button"
            onClick={onPrimary}
            disabled={busy}
            aria-label={`Make ${product.name} the main product`}
            title="Make this the main product (used in ads by default)"
            className="grid size-8 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border/60 hover:text-primary"
          >
            <Star className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`Remove ${product.name}`}
          title="Remove from the catalogue"
          className="grid size-8 place-items-center rounded-full bg-background/90 text-foreground shadow-sm ring-1 ring-border/60 hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
    </motion.li>
  );
}

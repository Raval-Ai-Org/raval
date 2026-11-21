"use client";

import { useRef, useState } from "react";
import {
  Check,
  ImagePlus,
  Pencil,
  ShoppingBag,
  Spinner,
  Trash,
  Wrench,
  AlertTriangle,
} from "@/components/icons";
import { dsGhostBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
import type { Product, ProductKind } from "@/lib/products/catalog";
import { cn } from "@/lib/utils";

export type ProductDraft = {
  kind: ProductKind;
  name: string;
  price: string;
  description: string;
  url: string;
};

export const draftFrom = (p?: Product | null, kind: ProductKind = "product"): ProductDraft => ({
  kind: p?.kind ?? kind,
  name: p?.name ?? "",
  price: p?.price ?? "",
  description: p?.description ?? "",
  url: p?.url ?? "",
});

const field =
  "w-full rounded-[var(--ds-radius-well)] border border-border/70 bg-[var(--ds-well-bg)] px-3 text-[14px] outline-none transition focus:border-primary/50 focus:ring-2 focus:ring-primary/20";

export function ProductForm({
  initial,
  saving,
  onSave,
  onCancel,
}: {
  initial: ProductDraft;
  saving: boolean;
  onSave: (draft: ProductDraft) => void;
  onCancel: () => void;
}) {
  const [d, setD] = useState(initial);
  const service = d.kind === "service";
  return (
    <form
      className="space-y-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (d.name.trim()) onSave(d);
      }}
    >
      <div className="ds-well inline-flex rounded-full p-1" role="radiogroup" aria-label="Type">
        {(["product", "service"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={d.kind === kind}
            onClick={() => setD({ ...d, kind })}
            className={cn(
              "h-7 rounded-full px-3 text-[12px] font-medium capitalize transition-colors",
              d.kind === kind ? "bg-card shadow-sm" : "text-muted-foreground",
            )}
          >
            {kind}
          </button>
        ))}
      </div>
      <input
        autoFocus
        aria-label="Name"
        value={d.name}
        maxLength={160}
        onChange={(e) => setD({ ...d, name: e.target.value })}
        placeholder={service ? "e.g. 1:1 coaching session" : "e.g. Cold brew, 1 litre"}
        className={cn(field, "h-10")}
      />
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <input
          aria-label="Price"
          value={d.price}
          maxLength={60}
          onChange={(e) => setD({ ...d, price: e.target.value })}
          placeholder="Price (optional)"
          className={cn(field, "h-10")}
        />
        <input
          aria-label="Page link"
          value={d.url}
          maxLength={600}
          inputMode="url"
          onChange={(e) => setD({ ...d, url: e.target.value })}
          placeholder="Page link (optional)"
          className={cn(field, "h-10")}
        />
      </div>
      <textarea
        aria-label="Description"
        value={d.description}
        maxLength={1200}
        rows={3}
        onChange={(e) => setD({ ...d, description: e.target.value })}
        placeholder={
          service
            ? "Who it's for and what they get"
            : "What it is, what's in it, what makes it good"
        }
        className={cn(field, "resize-none py-2.5 leading-relaxed")}
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className={cn(dsGhostBtn, "h-9 px-3.5 text-[13px]")}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!d.name.trim() || saving}
          className={cn(dsPrimaryBtn, "h-9 px-4 text-[13px]")}
        >
          {saving ? (
            <Spinner className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden />
          )}
          Save
        </button>
      </div>
    </form>
  );
}

/**
 * One row in the catalogue list (Holo): a small thumbnail, the name and one
 * grey line. A piece with no photo shows its kind's glyph, never an empty box.
 */
export function ProductRow({
  product,
  selected,
  onSelect,
}: {
  product: Product;
  selected: boolean;
  onSelect: () => void;
}) {
  const primary =
    product.images.find((i) => i.assetId === product.primaryAssetId) ?? product.images[0] ?? null;
  const service = product.kind === "service";
  const KindIcon = service ? Wrench : ShoppingBag;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "group flex w-full min-w-0 items-center gap-3 rounded-[16px] p-2 text-left transition-[background-color,box-shadow] duration-200",
        selected
          ? "bg-[var(--ds-card-bg)] shadow-[0_0_0_1.5px_var(--mox-green),0_10px_24px_-16px_rgb(46_230_107/0.9)]"
          : "hover:bg-[var(--ds-card-bg)] hover:shadow-[var(--ds-card-shadow)]",
      )}
    >
      <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[12px] bg-[var(--ds-well-bg)]">
        {primary?.url ? (
          <img
            src={primary.url}
            alt=""
            className="h-full w-full object-contain p-1"
            draggable={false}
          />
        ) : (
          <KindIcon className="size-4 text-muted-foreground" aria-hidden />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 block text-[13px] font-semibold leading-snug">
          {product.name}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] capitalize text-muted-foreground">
          {product.price ? `${product.price} · ${product.kind}` : product.kind}
        </span>
      </span>
    </button>
  );
}

/**
 * The chosen piece (Holo's product panel): its photos as tiles with an add
 * tile beside them, then the name, price and description, editable in place.
 * A piece with no photo gets one small add tile, not a big empty frame.
 */
export function ProductDetail({
  product,
  busy,
  lowResolution,
  readOnly,
  onSave,
  onArchive,
  onUpload,
  onPrimary,
}: {
  product: Product;
  busy: boolean;
  lowResolution?: boolean;
  readOnly?: boolean;
  onSave: (draft: ProductDraft) => void;
  onArchive: () => void;
  onUpload: (file: File) => void;
  onPrimary: (assetId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const primary =
    product.images.find((i) => i.assetId === product.primaryAssetId) ?? product.images[0] ?? null;
  const others = product.images.filter((i) => i.assetId !== primary?.assetId).slice(0, 4);
  const service = product.kind === "service";
  const KindIcon = service ? Wrench : ShoppingBag;

  return (
    <article className="min-w-0">
      <p className="ds-label">Photos</p>
      <div className="mt-2 flex flex-wrap items-start gap-2.5">
        {primary?.url ? (
          <div className="relative size-36 overflow-hidden rounded-[18px] border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] sm:size-40">
            <img
              src={primary.url}
              alt={product.name}
              className="h-full w-full object-contain p-2"
              draggable={false}
            />
            <span className="ds-grad-pill absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold">
              Main
            </span>
          </div>
        ) : null}
        {others.map((img) => (
          <button
            key={img.assetId}
            type="button"
            disabled={readOnly}
            aria-label="Use this photo"
            onClick={() => onPrimary(img.assetId)}
            className="size-[4.5rem] overflow-hidden rounded-[14px] border border-[var(--ds-card-border)] bg-[var(--ds-well-bg)] transition hover:-translate-y-0.5 hover:shadow-[var(--ds-card-shadow)]"
          >
            {img.url && <img src={img.url} alt="" className="h-full w-full object-contain p-1" />}
          </button>
        ))}
        {!readOnly && (
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className={cn(
              "flex items-center justify-center gap-1.5 border-[1.5px] border-dashed border-[var(--mox-green)]/45 bg-[var(--mox-green)]/[0.05] text-[11.5px] font-semibold text-foreground/70 transition hover:border-[var(--mox-green)] hover:bg-[var(--mox-green)]/10 hover:text-foreground disabled:opacity-50",
              primary?.url ? "size-[4.5rem] flex-col rounded-[14px]" : "h-12 rounded-full px-4",
            )}
          >
            {busy ? (
              <Spinner
                className="size-4 animate-spin text-[var(--mox-green)]"
                aria-label="Saving"
              />
            ) : (
              <ImagePlus className="size-4 text-[var(--mox-green)]" aria-hidden />
            )}
            {primary?.url ? "Add" : service ? "Add a photo (optional)" : "Add a real photo"}
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-label={`Upload a photo of ${product.name}`}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUpload(file);
          }}
        />
      </div>
      {lowResolution && (
        <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-[11.5px] text-warning">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Small photo. A larger one makes sharper
          posts.
        </p>
      )}

      <div className="mt-5">
        {editing ? (
          <ProductForm
            initial={draftFrom(product)}
            saving={busy}
            onCancel={() => setEditing(false)}
            onSave={(d) => {
              onSave(d);
              setEditing(false);
            }}
          />
        ) : (
          <>
            <div className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground">
                <KindIcon className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-[17px] font-bold leading-snug tracking-[-0.01em]">
                  {product.name}
                </h3>
                {product.price && (
                  <p className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                    {product.price}
                  </p>
                )}
              </div>
            </div>
            {product.description ? (
              <p className="mt-3 line-clamp-5 text-[13px] leading-relaxed text-foreground/75">
                {product.description}
              </p>
            ) : null}
            {!readOnly && (
              <div className="mt-5 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onArchive}
                  aria-label={`Remove ${product.name}`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-destructive/25 px-3.5 text-[12.5px] font-semibold text-destructive transition hover:bg-destructive/[0.07]"
                >
                  <Trash className="h-3.5 w-3.5" aria-hidden /> Remove
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  aria-label={`Edit ${product.name}`}
                  className={cn(dsGhostBtn, "h-9 px-3.5 text-[12.5px]")}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </article>
  );
}

"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  ImagePlus,
  Pencil,
  ShoppingBag,
  Spinner,
  Trash,
  Wrench,
  AlertTriangle,
} from "@/components/icons";
import { dsGhostBtn, dsIconBtn, dsPrimaryBtn } from "@/components/app/surface/buttons";
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

export function ProductCard({
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
  const service = product.kind === "service";
  const KindIcon = service ? Wrench : ShoppingBag;

  return (
    <article className="ds-tile flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] w-full bg-[var(--ds-well-bg)]">
        {primary?.url ? (
          <img
            src={primary.url}
            alt={product.name}
            className="h-full w-full object-contain p-3"
            draggable={false}
          />
        ) : (
          <button
            type="button"
            disabled={readOnly || busy}
            onClick={() => fileRef.current?.click()}
            className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none"
          >
            <span className="grid h-11 w-11 place-items-center rounded-full bg-primary/10 text-primary">
              {service ? (
                <KindIcon className="h-5 w-5" aria-hidden />
              ) : (
                <ImagePlus className="h-5 w-5" aria-hidden />
              )}
            </span>
            <span className="text-[12.5px] font-medium">
              {service ? "Add a photo (optional)" : "Add a real photo"}
            </span>
          </button>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center bg-background/60 backdrop-blur-[1px]">
            <Spinner className="h-5 w-5 animate-spin text-primary" aria-label="Saving" />
          </span>
        )}
        {primary?.url && !readOnly && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="absolute bottom-2 right-2 inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-card/90 px-3 text-[12px] font-medium backdrop-blur hover:bg-card"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden /> Change
          </button>
        )}
        <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-1 text-[11px] font-medium capitalize text-foreground/80 backdrop-blur">
          <KindIcon className="h-3 w-3" aria-hidden /> {product.kind}
        </span>
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

      {product.images.length > 1 && (
        <div className="flex gap-1.5 px-3 pt-3">
          {product.images.slice(0, 5).map((img) => (
            <button
              key={img.assetId}
              type="button"
              disabled={readOnly}
              aria-label="Use this photo"
              aria-pressed={img.assetId === primary?.assetId}
              onClick={() => onPrimary(img.assetId)}
              className={cn(
                "h-9 w-9 overflow-hidden rounded-lg border bg-[var(--ds-well-bg)]",
                img.assetId === primary?.assetId ? "border-primary" : "border-border/60",
              )}
            >
              {img.url && <img src={img.url} alt="" className="h-full w-full object-cover" />}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col p-3.5">
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
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="line-clamp-2 text-[14px] font-semibold leading-snug">
                  {product.name}
                </h3>
                {product.price && (
                  <p className="mt-0.5 text-[12.5px] tabular-nums text-muted-foreground">
                    {product.price}
                  </p>
                )}
              </div>
              {!readOnly && (
                <div className="flex shrink-0 items-center">
                  <button
                    type="button"
                    onClick={() => setEditing(true)}
                    className={dsIconBtn}
                    aria-label={`Edit ${product.name}`}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={onArchive}
                    className={dsIconBtn}
                    aria-label={`Remove ${product.name}`}
                  >
                    <Trash className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              )}
            </div>
            {product.description && (
              <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
                {product.description}
              </p>
            )}
            {lowResolution && (
              <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-warning-surface px-2.5 py-1 text-[11.5px] text-warning">
                <AlertTriangle className="h-3 w-3" aria-hidden /> Small photo. A larger one makes
                sharper posts.
              </p>
            )}
          </>
        )}
      </div>
    </article>
  );
}

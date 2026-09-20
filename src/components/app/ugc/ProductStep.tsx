"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Globe,
  ImagePlus,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import type { Product, ReferenceImageView } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import { Field, motionPreset, Panel, StepActions } from "./ugc-ui";

const EXTRACT_STAGES = [
  "Understanding your brand…",
  "Reading product details…",
  "Finding the strongest claims…",
  "Preparing your concept…",
];

export const EMPTY_PRODUCT: Product = {
  name: "",
  brand: "",
  url: null,
  description: "",
  price: "",
  category: "",
  images: [],
  facts: [],
  benefits: [],
  audienceHints: [],
  useCases: [],
};

export function ProductStep({
  workspaceId,
  workspaceWebsite,
  workspaceName,
  initialProduct,
  initialReferences,
  saving,
  onContinue,
}: {
  workspaceId: string;
  workspaceWebsite?: string | null;
  workspaceName?: string | null;
  initialProduct: Product | null;
  initialReferences: ReferenceImageView[];
  saving: boolean;
  onContinue: (product: Product, references: ReferenceImageView[]) => void;
}) {
  const [url, setUrl] = useState(initialProduct?.url ?? workspaceWebsite ?? "");
  const [showAdditionalWebsite, setShowAdditionalWebsite] = useState(false);
  const [additionalWebsite, setAdditionalWebsite] = useState("");
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [references, setReferences] = useState<ReferenceImageView[]>(initialReferences);
  const [extracting, setExtracting] = useState(false);
  const [stage, setStage] = useState(0);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importedUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!extracting) return;
    setStage(0);
    const id = window.setInterval(
      () => setStage((s) => Math.min(s + 1, EXTRACT_STAGES.length - 1)),
      4500,
    );
    return () => window.clearInterval(id);
  }, [extracting]);

  useEffect(() => {
    if (!initialProduct?.url) {
      setUrl(workspaceWebsite ?? "");
    }
  }, [initialProduct?.url, workspaceWebsite]);

  const extract = async () => {
    const value = (additionalWebsite || url || workspaceWebsite || "").trim();
    if (!value) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await ugcApi.extract(workspaceId, value);
      setProduct(result.product);
      setAnalyzed(result.analyzed);
      if (!result.product.facts.length) {
        toast.message("We couldn't find specific product facts on that page — add a few below.");
      }
    } catch (error) {
      setExtractError(
        error instanceof UgcApiError ? error.message : "Something went wrong reading that page.",
      );
    } finally {
      setExtracting(false);
    }
  };

  const update = (patch: Partial<Product>) =>
    setProduct((p) => ({ ...(p ?? EMPTY_PRODUCT), ...patch }));

  const addReference = (ref: ReferenceImageView) =>
    setReferences((refs) =>
      refs.some((r) => r.assetId === ref.assetId) ? refs : [...refs, ref].slice(0, 9),
    );

  const importImage = async (imageUrl: string) => {
    setImporting(imageUrl);
    try {
      const ref = await ugcApi.importReference(workspaceId, imageUrl);
      addReference({ assetId: ref.assetId, url: ref.url, filename: ref.filename });
      importedUrls.current.add(imageUrl);
    } catch (error) {
      toast.error(error instanceof UgcApiError ? error.message : "That image couldn't be added.");
    } finally {
      setImporting(null);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, 9 - references.length));
    if (!list.length) return;
    setUploading((n) => n + list.length);
    await Promise.all(
      list.map(async (file) => {
        try {
          const ref = await ugcApi.uploadReference(workspaceId, file);
          addReference({ assetId: ref.assetId, url: ref.url, filename: ref.filename });
        } catch (error) {
          toast.error(
            `${file.name}: ${error instanceof UgcApiError ? error.message : "upload failed"}`,
          );
        } finally {
          setUploading((n) => n - 1);
        }
      }),
    );
  };

  const canContinue = Boolean(product?.name.trim()) && uploading === 0 && !importing;

  return (
    <div className="space-y-4">
      <Panel className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-64 rounded-full bg-primary/10 blur-3xl"
        />
        <div className="relative space-y-3">
          <div>
            <h3 className="text-base font-semibold tracking-tight">What do you want to promote?</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Mellox can use your workspace context automatically and refine from a product page
              when you have one.
            </p>
          </div>

          {workspaceWebsite ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-border/70 bg-surface-3/60 px-3 py-1.5 text-xs text-muted-foreground">
              <span className="flex min-w-0 items-center gap-2">
                <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="truncate">Using workspace context</span>
              </span>
              <span className="min-w-0 truncate font-medium text-foreground">
                {workspaceName ?? workspaceWebsite.replace(/^https?:\/\//, "").replace(/\/$/, "")}
              </span>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-full border border-dashed border-border bg-surface-3/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="min-w-0 truncate">No workspace website connected</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                onClick={() => setShowAdditionalWebsite(true)}
              >
                Add website
              </Button>
            </div>
          )}

          <form
            className="flex flex-col gap-2 sm:flex-row sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void extract();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Globe
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                aria-label="Product page URL"
                inputMode="url"
                placeholder={workspaceWebsite ?? "https://yourstore.com/products/…"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="h-11 pl-9"
                disabled={extracting}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11 shrink-0"
              disabled={(!url.trim() && !workspaceWebsite) || extracting}
              loading={extracting}
            >
              {extracting ? null : <Sparkles aria-hidden />}
              {product?.url ? "Re-read page" : "Analyze product"}
            </Button>
          </form>

          {showAdditionalWebsite ? (
            <div className="rounded-xl border border-border/70 bg-surface-3/40 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <label
                  htmlFor="ugc-additional-website"
                  className="text-xs font-medium text-foreground/90"
                >
                  Additional website
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setShowAdditionalWebsite(false);
                    setAdditionalWebsite("");
                  }}
                  className="text-xs text-muted-foreground transition hover:text-foreground"
                >
                  Remove
                </button>
              </div>
              <Input
                id="ugc-additional-website"
                aria-label="Additional website"
                inputMode="url"
                value={additionalWebsite}
                onChange={(e) => setAdditionalWebsite(e.target.value)}
                placeholder="https://example.com/product-or-campaign"
                className="h-10"
              />
              <p className="mt-2 text-[11px] text-muted-foreground">
                For a specific product, campaign or landing page.
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowAdditionalWebsite(true)}
              className="inline-flex items-center gap-2 self-start text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              <Plus className="size-3.5" aria-hidden /> Add website
            </button>
          )}

          {!product && !extracting ? (
            <button
              type="button"
              onClick={() => setProduct({ ...EMPTY_PRODUCT })}
              className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Enter details manually instead
            </button>
          ) : null}
          {extractError ? (
            <p role="alert" className="flex items-start gap-2 text-sm text-danger">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                {extractError}{" "}
                {!product ? (
                  <button
                    type="button"
                    className="font-medium underline"
                    onClick={() => setProduct({ ...EMPTY_PRODUCT, url: null })}
                  >
                    Enter details manually
                  </button>
                ) : null}
              </span>
            </p>
          ) : null}
        </div>
      </Panel>

      <AnimatePresence mode="wait">
        {extracting ? (
          <motion.div
            key="loading"
            {...{ initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }}
            transition={motionPreset.base}
          >
            <Panel className="space-y-4">
              <p className="flex items-center gap-2 text-sm text-foreground" aria-live="polite">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
                {EXTRACT_STAGES[stage]}
              </p>
              <div className="grid gap-4 sm:grid-cols-[180px_1fr]">
                <Skeleton className="aspect-square w-full rounded-xl" />
                <div className="space-y-2.5">
                  <Skeleton className="h-6 w-2/3" />
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              </div>
            </Panel>
          </motion.div>
        ) : product ? (
          <motion.div
            key="review"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionPreset.medium}
            className="space-y-4"
          >
            {!analyzed ? (
              <p className="flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted-foreground ring-1 ring-border/60">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                We could only read the page's basic details. Check them and add the facts your ad
                can mention.
              </p>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <Panel className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Product name" htmlFor="ugc-name">
                    <Input
                      id="ugc-name"
                      value={product.name}
                      onChange={(e) => update({ name: e.target.value })}
                      placeholder="Glow Vitamin C Serum"
                    />
                  </Field>
                  <Field label="Brand" htmlFor="ugc-brand">
                    <Input
                      id="ugc-brand"
                      value={product.brand}
                      onChange={(e) => update({ brand: e.target.value })}
                    />
                  </Field>
                  <Field label="Price" htmlFor="ugc-price" hint="Optional">
                    <Input
                      id="ugc-price"
                      value={product.price}
                      onChange={(e) => update({ price: e.target.value })}
                    />
                  </Field>
                  <Field label="Category" htmlFor="ugc-category" hint="Optional">
                    <Input
                      id="ugc-category"
                      value={product.category}
                      onChange={(e) => update({ category: e.target.value })}
                    />
                  </Field>
                </div>
                <Field label="What it is" htmlFor="ugc-desc">
                  <Textarea
                    id="ugc-desc"
                    rows={3}
                    value={product.description}
                    onChange={(e) => update({ description: e.target.value })}
                    placeholder="One or two sentences: what it is and who it's for."
                  />
                </Field>
                <FactsEditor product={product} onChange={(facts) => update({ facts })} />
              </Panel>

              <Panel className="space-y-3">
                <div>
                  <h4 className="text-sm font-semibold">Product photos</h4>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The video model uses these to keep your packaging and label accurate.
                  </p>
                </div>
                {references.length ? (
                  <ul className="grid grid-cols-3 gap-2">
                    {references.map((ref) => (
                      <li
                        key={ref.assetId}
                        className="group relative aspect-square overflow-hidden rounded-xl bg-surface-3 ring-1 ring-border/60"
                      >
                        {ref.url ? (
                          <img
                            src={ref.url}
                            alt={ref.filename}
                            className="size-full object-cover"
                          />
                        ) : null}
                        <button
                          type="button"
                          aria-label={`Remove ${ref.filename}`}
                          onClick={() =>
                            setReferences((refs) => refs.filter((r) => r.assetId !== ref.assetId))
                          }
                          className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-background/85 text-foreground opacity-0 shadow-1 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-start gap-2 rounded-xl bg-surface-3/60 px-3 py-2 text-xs text-muted-foreground">
                    <AlertTriangle
                      className="mt-0.5 size-3.5 shrink-0 text-foreground/70"
                      aria-hidden
                    />
                    Without a photo the model has to imagine your product. Add at least one clear
                    shot.
                  </p>
                )}

                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    void uploadFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
                    dragging ? "border-primary bg-primary/10" : "border-border",
                  )}
                >
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                  ) : (
                    <Upload className="size-5 text-muted-foreground" aria-hidden />
                  )}
                  <p className="text-xs text-muted-foreground">
                    {uploading
                      ? `Uploading ${uploading}…`
                      : "Drop photos here, PNG/JPEG/WebP up to 10 MB"}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInput.current?.click()}
                    disabled={references.length >= 9}
                  >
                    <ImagePlus aria-hidden /> Upload photos
                  </Button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      if (e.target.files) void uploadFiles(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </div>

                {product.images.length ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground/90">From the product page</p>
                    <ul className="grid grid-cols-4 gap-2">
                      {product.images.map((img) => {
                        const added = importedUrls.current.has(img.url);
                        return (
                          <li key={img.url}>
                            <button
                              type="button"
                              onClick={() => void importImage(img.url)}
                              disabled={Boolean(importing) || added || references.length >= 9}
                              aria-label={added ? "Added" : `Use ${img.alt || "this image"}`}
                              className="group relative block aspect-square w-full overflow-hidden rounded-lg bg-surface-3 ring-1 ring-border/60 transition hover:ring-primary/60 disabled:cursor-default"
                            >
                              <img
                                src={img.url}
                                alt={img.alt}
                                loading="lazy"
                                referrerPolicy="no-referrer"
                                className="size-full object-cover"
                              />
                              <span className="absolute inset-0 grid place-items-center bg-background/55 opacity-0 transition-opacity group-hover:opacity-100 group-disabled:opacity-100">
                                {importing === img.url ? (
                                  <Loader2 className="size-4 animate-spin" aria-hidden />
                                ) : added ? (
                                  <Check className="size-4 text-primary" aria-hidden />
                                ) : (
                                  <Plus className="size-4" aria-hidden />
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </Panel>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {product && !extracting ? (
        <StepActions>
          {!product.facts.length ? (
            <span className="mr-auto text-xs text-muted-foreground">
              Tip: facts make the script specific.
            </span>
          ) : null}
          <Button
            size="lg"
            disabled={!canContinue}
            loading={saving}
            onClick={() => onContinue(product, references)}
          >
            Continue to brief
          </Button>
        </StepActions>
      ) : null}
    </div>
  );
}

function FactsEditor({
  product,
  onChange,
}: {
  product: Product;
  onChange: (facts: Product["facts"]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    const used = new Set(product.facts.map((f) => f.id));
    let n = product.facts.length + 1;
    while (used.has(`u${n}`)) n++;
    onChange(
      [...product.facts, { id: `u${n}`, text: text.slice(0, 300), source: "user" as const }].slice(
        0,
        40,
      ),
    );
    setDraft("");
  };
  return (
    <Field label="Product facts" hint={`${product.facts.length} — the only claims the ad may make`}>
      <ul className="space-y-1.5">
        {product.facts.map((fact) => (
          <li
            key={fact.id}
            className="group flex items-start gap-2 rounded-lg bg-surface-3/50 px-2.5 py-1.5 text-sm"
          >
            <Check className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
            <input
              aria-label="Fact"
              value={fact.text}
              onChange={(e) =>
                onChange(
                  product.facts.map((f) =>
                    f.id === fact.id ? { ...f, text: e.target.value, source: "user" as const } : f,
                  ),
                )
              }
              className="min-w-0 flex-1 bg-transparent outline-none"
            />
            <button
              type="button"
              aria-label="Remove fact"
              onClick={() => onChange(product.facts.filter((f) => f.id !== fact.id))}
              className="text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
            >
              <Trash2 className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add a true fact, e.g. “Ships in 2 days in the US”"
          className="h-9"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={!draft.trim()}>
          Add
        </Button>
      </div>
    </Field>
  );
}

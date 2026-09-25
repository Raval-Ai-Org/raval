"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle,
  Globe,
  ImagePlus,
  Loader2,
  PenLine,
  Plus,
  ScanLine,
  ShoppingBag,
  Sparkles,
  X,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ugcApi, UgcApiError } from "@/lib/ugc/client";
import type { Product, ReferenceImageView } from "@/lib/ugc/schemas";
import { cn } from "@/lib/utils";
import {
  Disclosure,
  itemVariants,
  listVariants,
  motionPreset,
  Panel,
  SectionLabel,
  StepActions,
  ThinkingLoader,
} from "./ugc-ui";

const EXTRACT_STAGES = [
  "Opening the page…",
  "Reading product details…",
  "Finding the facts…",
  "Picking photos…",
];

const MAX_REFS = 9;

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

function hostOf(url: string) {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

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
  const reduce = useReducedMotion();
  const [url, setUrl] = useState(initialProduct?.url ?? workspaceWebsite ?? "");
  const [product, setProduct] = useState<Product | null>(initialProduct);
  const [references, setReferences] = useState<ReferenceImageView[]>(initialReferences);
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [analyzed, setAnalyzed] = useState(true);
  const [importing, setImporting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importedUrls = useRef<Set<string>>(new Set());
  const refCount = useRef(initialReferences.length);
  useEffect(() => {
    refCount.current = references.length;
  }, [references.length]);

  useEffect(() => {
    if (!initialProduct?.url) setUrl(workspaceWebsite ?? "");
  }, [initialProduct?.url, workspaceWebsite]);

  const addReference = (ref: ReferenceImageView) =>
    setReferences((refs) =>
      refs.some((r) => r.assetId === ref.assetId) ? refs : [...refs, ref].slice(0, MAX_REFS),
    );

  const importImage = async (imageUrl: string, quiet = false) => {
    setImporting(imageUrl);
    try {
      const ref = await ugcApi.importReference(workspaceId, imageUrl);
      addReference({ assetId: ref.assetId, url: ref.url, filename: ref.filename });
      importedUrls.current.add(imageUrl);
    } catch (error) {
      if (!quiet)
        toast.error(error instanceof UgcApiError ? error.message : "That image couldn't be added.");
    } finally {
      setImporting(null);
    }
  };

  const extract = async () => {
    const value = (url || workspaceWebsite || "").trim();
    if (!value) return;
    setExtracting(true);
    setExtractError(null);
    try {
      const result = await ugcApi.extract(workspaceId, value);
      setProduct(result.product);
      setAnalyzed(result.analyzed);
      // A real product photo is the biggest single lift in video accuracy, so
      // start with the page's main image when the user hasn't added any.
      const first = result.product.images[0]?.url;
      if (first && refCount.current === 0) void importImage(first, true);
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

  const uploadFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, Math.max(0, MAX_REFS - references.length));
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

  const linkForm = (compact: boolean) => (
    <form
      data-no-rhythm
      className={cn(
        "flex w-full items-center gap-2 rounded-full bg-background p-1.5 text-left ring-1 ring-[var(--ds-tile-border)] transition-shadow focus-within:ring-2 focus-within:ring-primary/60",
        compact ? "h-12" : "h-14 shadow-[0_18px_50px_-24px_hsl(var(--primary)/0.55)]",
      )}
      onSubmit={(e) => {
        e.preventDefault();
        void extract();
      }}
    >
      <span
        aria-hidden
        className={cn(
          "grid shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground",
          compact ? "size-9" : "size-11",
        )}
      >
        <Globe className="size-4" />
      </span>
      <input
        aria-label="Product page link"
        inputMode="url"
        placeholder="Paste a product link"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        className={cn(
          "m-0 h-full min-w-0 flex-1 self-stretch bg-transparent px-1 text-left leading-none outline-none placeholder:text-muted-foreground disabled:opacity-60",
          compact ? "text-sm" : "text-[15px]",
        )}
        disabled={extracting}
      />
      <Button
        type="submit"
        size={compact ? "default" : "lg"}
        className={cn("m-0 h-full shrink-0 px-5", compact && "px-4")}
        disabled={(!url.trim() && !workspaceWebsite) || extracting}
        loading={extracting}
      >
        {extracting ? null : compact ? <ScanLine aria-hidden /> : <Sparkles aria-hidden />}
        {compact ? "Re-read" : "Analyze"}
      </Button>
    </form>
  );

  // ── 1. Nothing yet: one big link box ─────────────────────────────────────
  if (!product && !extracting) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-6 py-6 text-center sm:py-10">
        <motion.div
          initial={reduce ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative grid size-20 place-items-center"
        >
          <span className="absolute inset-0 rounded-[26px] bg-primary/20 blur-xl" aria-hidden />
          <span className="relative grid size-20 place-items-center rounded-[26px] bg-primary text-primary-foreground">
            <ShoppingBag className="size-9" aria-hidden />
          </span>
        </motion.div>
        <h3 className="ds-page-title text-2xl">What are we promoting?</h3>
        <div className="w-full">{linkForm(false)}</div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {workspaceWebsite ? (
            <button
              type="button"
              onClick={() => setUrl(workspaceWebsite)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors",
                url === workspaceWebsite
                  ? "bg-primary/15 text-foreground ring-1 ring-primary/50"
                  : "bg-[var(--ds-well-bg)] text-muted-foreground hover:text-foreground",
              )}
            >
              <span className="size-1.5 rounded-full bg-primary" aria-hidden />
              {workspaceName ?? hostOf(workspaceWebsite)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setProduct({ ...EMPTY_PRODUCT })}
            className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <PenLine className="size-3.5" aria-hidden /> Type it in
          </button>
        </div>
        {extractError ? (
          <p role="alert" className="flex items-start gap-2 text-left text-sm text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {extractError}
          </p>
        ) : null}
      </div>
    );
  }

  // ── 2. Reading the page ──────────────────────────────────────────────────
  if (extracting) {
    return (
      <div className="mx-auto grid max-w-2xl items-center gap-6 py-4 sm:grid-cols-[1fr_1fr]">
        <ScanningPage url={url} />
        <ThinkingLoader stages={EXTRACT_STAGES} icon={ScanLine} intervalMs={4500} />
      </div>
    );
  }

  if (!product) return null;
  const cover = references[0]?.url ?? product.images[0]?.url ?? null;

  // ── 3. Review ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {linkForm(true)}
      {extractError ? (
        <p role="alert" className="flex items-start gap-2 text-sm text-danger">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {extractError}
        </p>
      ) : null}
      {!analyzed ? (
        <p className="flex items-center gap-2 rounded-full bg-[var(--ds-well-bg)] px-3 py-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Only basic details found — check them below.
        </p>
      ) : null}

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={motionPreset.slow}
        className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]"
      >
        {/* Product card */}
        <Panel className="space-y-5">
          <div className="flex flex-col gap-4 sm:flex-row">
            <div className="relative size-24 shrink-0 overflow-hidden rounded-2xl bg-[var(--ds-well-bg)] sm:size-28">
              {cover ? (
                <motion.img
                  key={cover}
                  initial={{ opacity: 0, scale: 1.08 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={motionPreset.slow}
                  src={cover}
                  alt=""
                  referrerPolicy="no-referrer"
                  className="size-full! object-cover"
                />
              ) : (
                <ShoppingBag
                  className="absolute inset-0 m-auto size-8 text-muted-foreground"
                  aria-hidden
                />
              )}
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <input
                aria-label="Product name"
                value={product.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Product name"
                className="w-full rounded-lg bg-transparent px-1 py-0.5 text-lg font-semibold tracking-tight outline-none ring-primary/50 placeholder:text-muted-foreground/60 hover:bg-[var(--ds-well-bg)] focus:bg-[var(--ds-well-bg)] focus:ring-2"
              />
              <div className="flex flex-wrap gap-1.5">
                <InlinePill
                  label="Brand"
                  value={product.brand}
                  onChange={(brand) => update({ brand })}
                />
                <InlinePill
                  label="Price"
                  value={product.price}
                  onChange={(price) => update({ price })}
                />
                <InlinePill
                  label="Category"
                  value={product.category}
                  onChange={(category) => update({ category })}
                />
              </div>
              <Textarea
                aria-label="What it is"
                rows={2}
                value={product.description}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="What it is, in a sentence"
                className="min-h-0 resize-none text-[13px]"
              />
            </div>
          </div>
          <FactsEditor product={product} onChange={(facts) => update({ facts })} />
        </Panel>

        {/* Photos */}
        <Panel className="space-y-4">
          <SectionLabel
            icon={ImagePlus}
            trailing={
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {references.length}/{MAX_REFS}
              </span>
            }
          >
            Photos
          </SectionLabel>
          <motion.ul
            initial={reduce ? false : "hidden"}
            animate="show"
            variants={listVariants}
            className="grid grid-cols-3 gap-2"
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
          >
            <AnimatePresence initial={false}>
              {references.map((ref, i) => (
                <motion.li
                  key={ref.assetId}
                  layout={!reduce}
                  variants={reduce ? undefined : itemVariants}
                  exit={{ opacity: 0, scale: 0.8 }}
                  className="group relative aspect-square overflow-hidden rounded-2xl bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)]"
                >
                  {ref.url ? (
                    <img src={ref.url} alt={ref.filename} className="size-full! object-cover" />
                  ) : null}
                  {i === 0 ? (
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[9.5px] font-semibold text-primary-foreground">
                      Main
                    </span>
                  ) : null}
                  <button
                    type="button"
                    aria-label={`Remove ${ref.filename}`}
                    onClick={() =>
                      setReferences((refs) => refs.filter((r) => r.assetId !== ref.assetId))
                    }
                    className="absolute right-1.5 top-1.5 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                </motion.li>
              ))}
            </AnimatePresence>
            {references.length < MAX_REFS ? (
              <motion.li layout={!reduce} variants={reduce ? undefined : itemVariants}>
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  className={cn(
                    "flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
                    dragging ? "border-primary bg-primary/10" : "border-[var(--ds-tile-border)]",
                  )}
                >
                  {uploading ? (
                    <Loader2 className="size-5 animate-spin text-primary" aria-hidden />
                  ) : (
                    <Plus className="size-5" aria-hidden />
                  )}
                  <span className="text-[11px] font-medium">
                    {uploading ? `${uploading}…` : "Add"}
                  </span>
                </button>
              </motion.li>
            ) : null}
          </motion.ul>
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
          {!references.length ? (
            <p className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              Add one clear photo so the product looks right.
            </p>
          ) : null}

          {product.images.length ? (
            <div className="space-y-2">
              <SectionLabel icon={Globe}>From the page</SectionLabel>
              <ul className="grid grid-cols-4 gap-2">
                {product.images.map((img) => {
                  const added = importedUrls.current.has(img.url);
                  return (
                    <li key={img.url}>
                      <button
                        type="button"
                        onClick={() => void importImage(img.url)}
                        disabled={Boolean(importing) || added || references.length >= MAX_REFS}
                        aria-label={added ? "Added" : `Use ${img.alt || "this image"}`}
                        className="group relative block aspect-square w-full overflow-hidden rounded-xl bg-[var(--ds-well-bg)] ring-1 ring-[var(--ds-tile-border)] transition hover:ring-2 hover:ring-primary/60 disabled:cursor-default"
                      >
                        <img
                          src={img.url}
                          alt={img.alt}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                          className="size-full! object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <span
                          className={cn(
                            "absolute inset-0 grid place-items-center transition-opacity",
                            added
                              ? "bg-primary/35 opacity-100"
                              : "bg-black/45 text-white opacity-0 group-hover:opacity-100",
                            importing === img.url && "opacity-100",
                          )}
                        >
                          {importing === img.url ? (
                            <Loader2 className="size-4 animate-spin" aria-hidden />
                          ) : added ? (
                            <span className="grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                              <Check className="size-3.5" aria-hidden />
                            </span>
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
      </motion.div>

      <StepActions>
        <Button
          size="lg"
          disabled={!canContinue}
          loading={saving}
          onClick={() => onContinue(product, references)}
        >
          Next <ArrowRight aria-hidden />
        </Button>
      </StepActions>
    </div>
  );
}

/** A mock web page with a lime scan line sweeping over it while we read. */
function ScanningPage({ url }: { url: string }) {
  return (
    <div className="ds-tile relative overflow-hidden p-4" aria-hidden>
      <div className="mb-3 flex items-center gap-1.5">
        <span className="size-2 rounded-full bg-[var(--ds-well-bg-hover)]" />
        <span className="size-2 rounded-full bg-[var(--ds-well-bg-hover)]" />
        <span className="size-2 rounded-full bg-[var(--ds-well-bg-hover)]" />
        <span className="ml-2 min-w-0 flex-1 truncate rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[10px] text-muted-foreground">
          {hostOf(url) || "your page"}
        </span>
      </div>
      <div className="grid grid-cols-[72px_1fr] gap-3">
        <div className="aspect-square rounded-xl bg-[var(--ds-well-bg-hover)]" />
        <div className="space-y-2">
          {[80, 50, 95, 70, 60].map((w, i) => (
            <div
              key={i}
              className="relative h-2.5 overflow-hidden rounded-full bg-[var(--ds-well-bg-hover)]"
              style={{ width: `${w}%` }}
            >
              <motion.span
                className="absolute inset-0 bg-primary/45"
                animate={{ opacity: [0, 1, 0] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.35 }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="flex h-5 items-center gap-1 rounded-full bg-primary/15 px-2 text-[9.5px] font-medium text-primary"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: [0, 1, 1, 0], scale: [0.8, 1, 1, 0.9] }}
            transition={{ duration: 4, repeat: Infinity, delay: 1 + i * 0.7 }}
          >
            <Check className="size-2.5" /> fact
          </motion.span>
        ))}
      </div>
      <motion.div
        className="pointer-events-none absolute inset-x-0 h-16 bg-gradient-to-b from-transparent via-primary/30 to-transparent"
        initial={{ top: "-20%" }}
        animate={{ top: "110%" }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
      />
    </div>
  );
}

/** A small "Label: value" pill that edits in place. */
function InlinePill({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="group inline-flex h-7 max-w-full items-center gap-1 rounded-full bg-[var(--ds-well-bg)] pl-2.5 pr-1 text-[11.5px] ring-primary/50 focus-within:ring-2">
      <span className="text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="—"
        size={Math.max(3, Math.min(value.length || 1, 22))}
        className="min-w-0 bg-transparent px-1 font-medium outline-none placeholder:text-muted-foreground/60"
      />
    </label>
  );
}

function FactsEditor({
  product,
  onChange,
}: {
  product: Product;
  onChange: (facts: Product["facts"]) => void;
}) {
  const reduce = useReducedMotion();
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
  const facts = (
    <>
      <ul className="space-y-1.5">
        <AnimatePresence initial={false}>
          {product.facts.map((fact) => (
            <motion.li
              key={fact.id}
              layout={!reduce}
              initial={reduce ? false : { opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={motionPreset.base}
              className="group flex items-center gap-2 rounded-xl bg-[var(--ds-well-bg)] px-2.5 py-1.5 text-[13px]"
            >
              <CheckCircle className="size-4 shrink-0 text-primary" aria-hidden />
              <input
                aria-label="Fact"
                value={fact.text}
                onChange={(e) =>
                  onChange(
                    product.facts.map((f) =>
                      f.id === fact.id
                        ? { ...f, text: e.target.value, source: "user" as const }
                        : f,
                    ),
                  )
                }
                className="min-w-0 flex-1 bg-transparent outline-none"
              />
              <button
                type="button"
                aria-label="Remove fact"
                onClick={() => onChange(product.facts.filter((f) => f.id !== fact.id))}
                className="grid size-6 place-items-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-[var(--ds-well-bg-hover)] hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <form
        data-no-rhythm
        className="flex items-center gap-1.5 rounded-full bg-[var(--ds-well-bg)] p-1 pl-3 ring-primary/50 focus-within:ring-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Plus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <input
          aria-label="Add a fact"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a true fact"
          className="h-7 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
        <Button type="submit" size="sm" variant="secondary" disabled={!draft.trim()}>
          Add
        </Button>
      </form>
    </>
  );
  return (
    <div className="space-y-2.5">
      <SectionLabel
        icon={CheckCircle}
        trailing={
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums",
              product.facts.length
                ? "bg-primary/15 text-primary"
                : "bg-[var(--ds-well-bg)] text-muted-foreground",
            )}
          >
            {product.facts.length}
          </span>
        }
      >
        Facts the ad can say
      </SectionLabel>
      {product.facts.length > 6 ? (
        <Disclosure label={`Show all ${product.facts.length}`} className="rounded-2xl">
          {facts}
        </Disclosure>
      ) : (
        facts
      )}
    </div>
  );
}

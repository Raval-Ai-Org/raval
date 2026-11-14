"use client";
// What a piece is about, and how an ad is laid out: one product from the
// brand's catalogue (ADR-0035, Brain → Brand → Products) and one of the proven
// ad layouts (src/lib/studio/ad-formats.ts). A picked product's single picture
// is a product poster made from its own photo (ADR-0040), so the ad layouts
// that draw a product are not offered. A product the brief names is picked by itself
// (src/lib/products/feature.ts), the same way the server picks it.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Ban, Briefcase, Check, Plus, ShoppingBag } from "@/components/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { useReducedMotionSafe } from "@/hooks/use-reduced-motion-safe";
import { emitAppEvent } from "@/lib/app-events";
import { cn } from "@/lib/utils";
import { adFormatsFor, type AdFormat, type AdFormatThumb } from "@/lib/studio/ad-formats";
import { AD_OBJECTIVES, preferFormats, type AdObjectiveId } from "@/lib/studio/ad-objectives";
import { listProducts } from "@/lib/products.functions";
import type { Product } from "@/lib/products/catalog";
import { namedProduct, productPhotoControls } from "@/lib/products/feature";
import { updateSession, type StudioSession } from "@/lib/studio/session-store";
import { FieldLabel } from "./studio-ui";

/** React Query keys for the catalogue as Studio reads it (workspace-scoped). */
export const studioProductKeys = {
  list: (workspaceId: string) => ["studio", "products", workspaceId] as const,
};

export function useStudioProducts(workspaceId: string) {
  return useQuery({
    queryKey: studioProductKeys.list(workspaceId),
    queryFn: async (): Promise<Product[]> =>
      (await listProducts({ data: { workspaceId } })).filter((p) => p.status === "active"),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

/** The product's photos, main first, as `productPhotoControls` takes them. */
export function productPhotoIds(product: Product | null | undefined): string[] {
  if (!product || product.kind !== "product") return [];
  const ids = product.images.map((img) => img.assetId);
  const main = product.primaryAssetId && ids.includes(product.primaryAssetId);
  return main
    ? [product.primaryAssetId!, ...ids.filter((id) => id !== product.primaryAssetId)]
    : ids;
}

/**
 * Picks the product the brief names while the person hasn't chosen one, and
 * lets it go again when the brief stops naming it. Returns the session's
 * product. The server makes the same pick, so the price shown is what runs.
 */
export function useBriefProduct(session: StudioSession): Product | null {
  const { data: products } = useStudioProducts(session.workspaceId);
  const auto = useRef<string | null>(null);
  const { productId, noProduct } = session.controls;
  useEffect(() => {
    if (!products?.length || noProduct || session.lastGood) return;
    if (productId && productId !== auto.current) return;
    const named = namedProduct(
      session.brief,
      products.map((p) => ({ ...p, hasPhoto: p.images.length > 0 })),
    );
    const next = named?.id ?? null;
    if (next === (productId ?? null)) return;
    auto.current = next;
    updateSession(session.id, {
      controls: { ...session.controls, productId: next ?? undefined },
    });
  }, [
    products,
    session.brief,
    productId,
    noProduct,
    session.lastGood,
    session.id,
    session.controls,
  ]);
  return products?.find((p) => p.id === productId) ?? null;
}

/** The session's controls as the server will run them with the product's photos. */
export function withProductPhotos(
  session: StudioSession,
  product: Product | null,
): StudioSession["controls"] {
  const photos = productPhotoControls({
    type: session.type,
    controls: session.controls,
    photoIds: productPhotoIds(product),
    revision: false,
    designEnabled: true,
    heroEnabled: true,
  });
  return photos
    ? {
        ...session.controls,
        ...photos,
        ...(photos.referenceMode === "design" ? { photoFidelity: "exact" as const } : {}),
      }
    : session.controls;
}

/**
 * What the piece is about: big cards, one per product or service from the
 * catalogue, with "None" first so a pick can always be undone. A press on
 * the chosen card lets it go again too.
 */
export function ProductPicker({
  workspaceId,
  value,
  type,
  onChange,
  showEmpty = false,
  title = "Product or service",
}: {
  workspaceId: string;
  value: string | undefined;
  type: string;
  onChange: (productId: string | undefined) => void;
  /** With an empty catalogue, show a card that opens Brain → Products. */
  showEmpty?: boolean;
  title?: string;
}) {
  const { data: products, isLoading } = useStudioProducts(workspaceId);
  const reduce = useReducedMotionSafe();
  if (isLoading && showEmpty)
    return (
      <div>
        <FieldLabel>{title}</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-[132px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  if (!products?.length) {
    if (!showEmpty) return null;
    return (
      <div>
        <FieldLabel>{title}</FieldLabel>
        <button
          type="button"
          onClick={() => emitAppEvent("open:brain", { section: "brand", tab: "products" })}
          className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-border bg-surface-3 p-3 text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--ds-well-bg)] text-muted-foreground">
            <Plus className="size-5" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-foreground">
              Add your products or services
            </span>
            <span className="block text-xs text-muted-foreground">
              Then pick one here and Mellox shows the real thing.
            </span>
          </span>
        </button>
      </div>
    );
  }
  const chosen = products.find((p) => p.id === value);
  return (
    <div className="@container">
      <FieldLabel hint={chosen ? undefined : "Optional"}>{title}</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Product or service this piece is about"
        className="grid grid-cols-2 gap-2 @md:grid-cols-3"
      >
        <ProductCard
          index={0}
          reduce={reduce}
          active={!chosen}
          onClick={() => onChange(undefined)}
          label="None"
          detail="Not about one product"
        />
        {products.map((p, i) => {
          const photo =
            p.images.find((img) => img.assetId === p.primaryAssetId)?.url ??
            p.images[0]?.url ??
            undefined;
          return (
            <ProductCard
              key={p.id}
              index={i + 1}
              reduce={reduce}
              active={value === p.id}
              onClick={() => onChange(value === p.id ? undefined : p.id)}
              label={p.name}
              detail={[p.kind === "service" ? "Service" : "Product", p.price]
                .filter(Boolean)
                .join(" · ")}
              photo={photo}
              service={p.kind === "service"}
            />
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {!chosen
          ? "Pick one, or name it in your brief, to show the real thing."
          : !productPhotoIds(chosen).length
            ? `Written about ${chosen.name} with its real name, price and facts.${chosen.kind === "product" ? " Add a photo in Brain → Products to show it too." : ""}`
            : type === "carousel"
              ? "Its real photos go on the slides, unchanged."
              : type === "video" || type === "story"
                ? "Made from its real photo, so it looks like itself."
                : "Designed around its real photo. The photo itself is never changed."}
      </p>
    </div>
  );
}

function ProductCard({
  label,
  detail,
  photo,
  service,
  active,
  onClick,
  index,
  reduce,
}: {
  label: string;
  detail: string;
  photo?: string;
  service?: boolean;
  active: boolean;
  onClick: () => void;
  index: number;
  reduce: boolean;
}) {
  const none = label === "None" && !photo && service === undefined;
  return (
    <motion.button
      type="button"
      role="radio"
      aria-checked={active}
      title={label}
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: reduce ? 0 : Math.min(index, 8) * 0.03 }}
      whileHover={reduce ? undefined : { y: -2 }}
      whileTap={reduce ? undefined : { scale: 0.97 }}
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border text-left transition-[border-color,box-shadow]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
        active
          ? "border-primary-border shadow-[0_0_0_3px_hsl(var(--primary)/0.18),0_14px_30px_-18px_hsl(var(--primary)/0.9)]"
          : none
            ? "border-dashed border-border bg-surface-3 hover:border-foreground/30"
            : "border-border bg-surface-3 hover:border-border-strong",
      )}
    >
      <span
        className={cn(
          "relative block aspect-[4/3] w-full overflow-hidden",
          none ? "bg-transparent" : "bg-[var(--ds-well-bg)]",
        )}
      >
        {photo ? (
          <img
            src={photo}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="grid size-full place-items-center text-muted-foreground">
            {none ? (
              <Ban className="size-6" />
            ) : service ? (
              <Briefcase className="size-6" />
            ) : (
              <ShoppingBag className="size-6" />
            )}
          </span>
        )}
        <AnimatePresence>
          {active ? (
            <motion.span
              key="tick"
              initial={reduce ? false : { scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={reduce ? undefined : { scale: 0.4, opacity: 0 }}
              transition={{ type: "spring", stiffness: 520, damping: 30 }}
              className="absolute right-2 top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-md"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </motion.span>
          ) : null}
        </AnimatePresence>
      </span>
      <span className={cn("block px-2.5 py-2", active && "bg-primary-surface")}>
        <span className="block truncate text-[12.5px] font-semibold text-foreground">{label}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
      </span>
    </motion.button>
  );
}

/** What the ad is for (ad-objectives.ts): it decides the copy, button and layouts. */
export function AdObjectivePicker({
  value,
  onChange,
}: {
  value: AdObjectiveId | undefined;
  onChange: (adObjective: AdObjectiveId | undefined) => void;
}) {
  const options = [
    { id: undefined, label: "Auto", tagline: "Read from your brief" },
    ...AD_OBJECTIVES.map((o) => ({ id: o.id, label: o.label, tagline: o.tagline })),
  ];
  return (
    <div>
      <FieldLabel>What is this ad for?</FieldLabel>
      <div role="radiogroup" aria-label="What is this ad for?" className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = value === o.id;
          return (
            <button
              key={o.id ?? "auto"}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.tagline}
              onClick={() => onChange(o.id)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55",
                active
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border bg-surface-3 text-muted-foreground hover:border-foreground/25 hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11.5px] text-muted-foreground">
        {value
          ? AD_OBJECTIVES.find((o) => o.id === value)?.tagline
          : "Mellox reads it from your brief. Ads are written to get one action, not likes."}
      </p>
    </div>
  );
}

export function AdFormatPicker({
  value,
  objective,
  onChange,
}: {
  value: string | undefined;
  /** The ad's objective: its best layouts are shown first. */
  objective?: AdObjectiveId;
  onChange: (adFormat: string | undefined) => void;
}) {
  return (
    <div>
      <FieldLabel>Ad layout</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Ad layout"
        className="grid grid-cols-4 gap-1.5 sm:grid-cols-6"
      >
        <FormatTile
          label="Auto"
          tagline="Picked for your goal, different each time"
          active={!value}
          onClick={() => onChange(undefined)}
        />
        {preferFormats(
          adFormatsFor(false),
          AD_OBJECTIVES.find((o) => o.id === objective),
        ).map((f) => (
          <FormatTile
            key={f.id}
            format={f}
            label={f.label}
            tagline={f.tagline}
            active={value === f.id}
            onClick={() => onChange(f.id)}
          />
        ))}
      </div>
    </div>
  );
}

function FormatTile({
  format,
  label,
  tagline,
  active,
  disabled,
  onClick,
}: {
  format?: AdFormat;
  label: string;
  tagline: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      title={tagline}
      className={cn(
        "group flex min-w-0 flex-col gap-1 rounded-xl border p-1 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:cursor-not-allowed disabled:opacity-45",
        active
          ? "border-primary bg-primary/10"
          : "border-border bg-surface-3 hover:border-foreground/25",
      )}
    >
      <span className="block aspect-[4/5] w-full overflow-hidden rounded-lg bg-[var(--ds-well-bg)]">
        <Thumb kind={format?.thumb} />
      </span>
      <span className="truncate px-0.5 text-[11px] font-medium leading-tight text-foreground">
        {label}
      </span>
    </button>
  );
}

/** A tiny drawing of the layout: where the product, headline and button sit. */
function Thumb({ kind }: { kind?: AdFormatThumb }) {
  const ink = "fill-foreground/70";
  const soft = "fill-foreground/20";
  const accent = "fill-primary-ink";
  const product = (x: number, y: number, w: number, h: number) => (
    <rect x={x} y={y} width={w} height={h} rx={6} className="fill-foreground/45" />
  );
  const line = (x: number, y: number, w: number, cls = soft, h = 4) => (
    <rect x={x} y={y} width={w} height={h} rx={2} className={cls} />
  );
  const button = (y = 104) => (
    <rect x={30} y={y} width={40} height={9} rx={4.5} className={accent} />
  );
  const body = (() => {
    switch (kind) {
      case "hero":
        return (
          <>
            {line(18, 14, 64, ink, 8)}
            {line(26, 27, 48)}
            {product(30, 42, 40, 52)}
            {button()}
          </>
        );
      case "callouts":
        return (
          <>
            {line(18, 12, 64, ink, 7)}
            {product(36, 40, 28, 50)}
            {[44, 62, 80].map((y, i) => (
              <g key={y}>
                {line(i % 2 ? 70 : 8, y, 22)}
                <rect x={i % 2 ? 64 : 30} y={y + 1.5} width={8} height={1} className={ink} />
              </g>
            ))}
          </>
        );
      case "versus":
        return (
          <>
            {line(14, 10, 72, ink, 7)}
            <rect x={6} y={24} width={42} height={92} rx={6} className="fill-foreground/10" />
            <rect x={52} y={24} width={42} height={92} rx={6} className="fill-primary-ink/40" />
            {[38, 54, 70].map((y) => (
              <g key={y}>
                {line(12, y, 30)}
                {line(58, y, 30, ink)}
              </g>
            ))}
            {product(62, 88, 22, 22)}
          </>
        );
      case "split":
        return (
          <>
            <rect x={0} y={0} width={50} height={125} className="fill-foreground/10" />
            <rect x={50} y={0} width={50} height={125} className="fill-primary-ink/25" />
            {product(62, 46, 26, 38)}
            {line(14, 104, 72, ink, 7)}
          </>
        );
      case "quote":
        return (
          <>
            <rect x={10} y={18} width={80} height={72} rx={8} className="fill-background" />
            <text x={16} y={40} className={cn(accent, "text-[22px] font-bold")}>
              “
            </text>
            {line(20, 46, 60, ink, 6)}
            {line(20, 56, 52, ink, 6)}
            {line(20, 74, 30)}
            {product(68, 82, 24, 30)}
          </>
        );
      case "offer":
        return (
          <>
            <circle cx={76} cy={22} r={15} className={accent} />
            {product(12, 42, 44, 56)}
            {line(12, 14, 46, ink, 8)}
            {line(62, 56, 30)}
            {button(106)}
          </>
        );
      case "question":
        return (
          <>
            <rect x={0} y={0} width={100} height={125} className="fill-foreground/80" />
            <rect x={12} y={16} width={76} height={10} rx={3} className="fill-background" />
            <rect x={12} y={30} width={56} height={10} rx={3} className="fill-background" />
            {product(34, 62, 32, 40)}
          </>
        );
      case "stat":
        return (
          <>
            <text
              x={50}
              y={62}
              textAnchor="middle"
              className={cn(accent, "text-[40px] font-black")}
            >
              3x
            </text>
            {line(20, 76, 60, ink, 6)}
            {product(72, 92, 18, 22)}
          </>
        );
      case "note":
        return (
          <>
            <rect x={12} y={10} width={76} height={90} rx={4} className="fill-background" />
            {line(20, 20, 50, ink, 6)}
            {[36, 50, 64].map((y) => (
              <g key={y}>
                <circle cx={22} cy={y + 2} r={2} className={accent} />
                {line(28, y, 50)}
              </g>
            ))}
            {product(56, 86, 28, 30)}
          </>
        );
      case "lifestyle":
        return (
          <>
            <rect x={0} y={0} width={100} height={125} className="fill-foreground/25" />
            <circle cx={30} cy={30} r={16} className="fill-foreground/15" />
            {product(40, 40, 30, 40)}
            <rect x={14} y={92} width={72} height={12} rx={6} className="fill-background" />
          </>
        );
      case "flatlay":
        return (
          <>
            {line(22, 12, 56, ink, 7)}
            <circle cx={22} cy={52} r={9} className={soft} />
            <rect x={70} y={40} width={16} height={22} rx={3} className={soft} />
            <circle cx={78} cy={92} r={8} className={soft} />
            {product(34, 46, 32, 46)}
            <rect x={14} y={86} width={14} height={14} rx={3} className={soft} />
          </>
        );
      case "steps":
        return (
          <>
            {line(16, 12, 68, ink, 7)}
            {[8, 38, 68].map((x, i) => (
              <g key={x}>
                <rect x={x} y={32} width={24} height={70} rx={5} className="fill-foreground/10" />
                <circle cx={x + 12} cy={44} r={6} className={accent} />
                {i === 2 ? product(x + 4, 60, 16, 22) : line(x + 4, 66, 16)}
              </g>
            ))}
          </>
        );
      case "grid":
        return (
          <>
            {[
              [6, 6],
              [52, 6],
              [6, 66],
              [52, 66],
            ].map(([x, y]) => (
              <rect
                key={`${x}${y}`}
                x={x}
                y={y}
                width={42}
                height={53}
                rx={5}
                className="fill-foreground/35"
              />
            ))}
            <rect x={10} y={56} width={80} height={12} rx={3} className="fill-background" />
          </>
        );
      case "type":
        return (
          <>
            {line(10, 16, 80, ink, 14)}
            {line(10, 34, 64, accent, 14)}
            {line(10, 52, 74, ink, 14)}
            {line(10, 90, 50)}
            {product(74, 96, 16, 20)}
          </>
        );
      default:
        return (
          <>
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={i % 2 ? 54 : 10}
                y={i < 2 ? 22 : 66}
                width={36}
                height={36}
                rx={8}
                className={i === 0 ? accent : soft}
              />
            ))}
          </>
        );
    }
  })();
  return (
    <svg viewBox="0 0 100 125" className="size-full" aria-hidden>
      {body}
    </svg>
  );
}

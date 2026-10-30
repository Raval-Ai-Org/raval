"use client";
// What a piece is about, and how an ad is laid out: one product from the
// brand's catalogue (ADR-0035, Brain → Brand → Products) and one of the proven
// ad layouts (src/lib/studio/ad-formats.ts). A picked product is shown with
// its own photos, never redrawn, so only layouts that don't redraw a product
// are offered. A product the brief names is picked by itself
// (src/lib/products/feature.ts), the same way the server picks it.
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag } from "@/components/icons";
import { cn } from "@/lib/utils";
import { adFormatsFor, type AdFormat, type AdFormatThumb } from "@/lib/studio/ad-formats";
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

const chip =
  "flex h-14 shrink-0 items-center gap-2 rounded-2xl border px-2.5 text-left text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55";
const on = "border-primary bg-primary/10 text-foreground";
const off = "border-border bg-surface-3 text-muted-foreground hover:text-foreground";

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
  });
  return photos
    ? {
        ...session.controls,
        ...photos,
        ...(photos.referenceMode === "design" ? { photoFidelity: "exact" as const } : {}),
      }
    : session.controls;
}

export function ProductPicker({
  workspaceId,
  value,
  type,
  onChange,
}: {
  workspaceId: string;
  value: string | undefined;
  type: string;
  onChange: (productId: string | undefined) => void;
}) {
  const { data: products } = useStudioProducts(workspaceId);
  if (!products?.length) return null;
  return (
    <div>
      <FieldLabel>Product</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Product this piece is about"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [contain:inline-size]"
      >
        <button
          type="button"
          role="radio"
          aria-checked={!value}
          onClick={() => onChange(undefined)}
          className={cn(chip, !value ? on : off)}
        >
          No product
        </button>
        {products.map((p) => {
          const active = value === p.id;
          const photo =
            p.images.find((img) => img.assetId === p.primaryAssetId)?.url ?? p.images[0]?.url;
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(p.id)}
              title={p.name}
              className={cn(chip, "max-w-[190px]", active ? on : off)}
            >
              <span className="size-9 shrink-0 overflow-hidden rounded-xl bg-[var(--ds-well-bg)]">
                {photo ? (
                  <img src={photo} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <ShoppingBag className="m-2.5 size-4" />
                )}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {!value
          ? "Pick a product, or name it in your brief, to show the real thing."
          : !productPhotoIds(products.find((p) => p.id === value)).length
            ? "Written about this product with its real name, price and facts. Add a photo in Brain → Products to show it too."
            : type === "carousel"
              ? "Its real photos go on the slides, unchanged."
              : type === "video" || type === "story"
                ? "Made from its real photo, so the product looks like itself."
                : "Designed around its real photo. The photo itself is never changed."}
      </p>
    </div>
  );
}

export function AdFormatPicker({
  value,
  onChange,
}: {
  value: string | undefined;
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
        {adFormatsFor(false).map((f) => (
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
  const accent = "fill-primary";
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
            <rect x={52} y={24} width={42} height={92} rx={6} className="fill-primary/40" />
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
            <rect x={50} y={0} width={50} height={125} className="fill-primary/25" />
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

"use client";
// What an ad or picture shows, and how an ad is laid out: the brand's real
// product (from Brain → Brand → Products) and one of the proven ad layouts
// (src/lib/studio/ad-formats.ts). "Auto" leaves both to Studio.
import { ShoppingBag } from "@/components/icons";
import { cn } from "@/lib/utils";
import { AD_FORMATS, type AdFormat, type AdFormatThumb } from "@/lib/studio/ad-formats";
import { useProducts } from "@/components/app/brain/brand/products/hooks";
import { FieldLabel } from "./studio-ui";

const chip =
  "flex h-14 shrink-0 items-center gap-2 rounded-2xl border px-2.5 text-left text-[12.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55";
const on = "border-primary bg-primary/10 text-foreground";
const off = "border-border bg-surface-3 text-muted-foreground hover:text-foreground";

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
  const { data: products } = useProducts(workspaceId);
  if (!products?.length) return null;
  const auto = !value;
  return (
    <div>
      <FieldLabel>Product</FieldLabel>
      <div
        role="radiogroup"
        aria-label="Product to show"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [contain:inline-size]"
      >
        <button
          type="button"
          role="radio"
          aria-checked={auto}
          onClick={() => onChange(undefined)}
          className={cn(chip, auto ? on : off)}
        >
          <span className="grid size-9 place-items-center rounded-xl bg-[var(--ds-well-bg)] text-[11px] font-semibold">
            Auto
          </span>
        </button>
        {products.map((p) => {
          const active = value === p.id;
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
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : (
                  <ShoppingBag className="m-2.5 size-4" />
                )}
              </span>
              <span className="truncate">{p.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={value === "none"}
          onClick={() => onChange("none")}
          className={cn(chip, value === "none" ? on : off)}
        >
          No product
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {auto
          ? type === "ad"
            ? "Ads show your main product unless the brief names another."
            : "Shows a product when your brief names one."
          : value === "none"
            ? "Nothing from your catalogue is shown."
            : "This exact product is shown, photographed from your catalogue."}
      </p>
    </div>
  );
}

export function AdFormatPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: string | undefined;
  onChange: (adFormat: string | undefined) => void;
}) {
  const { data: products } = useProducts(workspaceId);
  const hasProduct = !!products?.length;
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
        {AD_FORMATS.map((f) => (
          <FormatTile
            key={f.id}
            format={f}
            label={f.label}
            tagline={f.needsProduct && !hasProduct ? "Add a product first" : f.tagline}
            disabled={f.needsProduct && !hasProduct}
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

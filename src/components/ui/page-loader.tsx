import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";

/**
 * The Mellox loading mark: the logo inside a turning lime ring. Pure CSS
 * (styles.css `.mx-loader`), so it moves from the first paint — before the
 * page's JavaScript has loaded — and keeps moving with reduced motion.
 */
export function MelloxLoader({ size = 56, className }: { size?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("mx-loader", className)} style={{ width: size, height: size }}>
      <span className="mx-loader__ring" />
      <span className="mx-loader__glow" />
      <span className="mx-loader__mark">
        <Logo height={Math.round(size * 0.42)} markOnly />
      </span>
    </span>
  );
}

/** Full-screen loading state: the Mellox mark and one short line. */
export function PageLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mx-page-loader flex min-h-dvh w-full flex-col items-center justify-center gap-5 bg-background",
        className,
      )}
    >
      <MelloxLoader />
      <span className="mx-loader__label text-[14px] font-medium">{label}</span>
    </div>
  );
}

/**
 * Shown while a panel's code downloads after a click, so the wait is never
 * silent. It fades in after a short delay, so fast loads never flash it.
 */
export function OpeningPill({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-opening-pill pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center"
    >
      <span className="flex items-center gap-2.5 rounded-full border border-border/70 bg-background/95 py-1.5 pl-2 pr-4 text-[13px] font-medium text-foreground shadow-lg backdrop-blur-xl">
        <MelloxLoader size={22} />
        {label}
      </span>
    </div>
  );
}

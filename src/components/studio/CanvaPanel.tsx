"use client";
import { CanvaMark } from "@/components/brand/CanvaMark";
import { CornerDownLeft, RotateCcw, Spinner } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type CanvaPanelProps = {
  /** `tool` sits in a row of small toolbar buttons. */
  variant?: "button" | "tool";
  className?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How Canva opened the picture; null before it has been opened there. */
  mode: "magic_layers" | "flat_image" | "design_import" | null;
  slideCount: number;
  /** A Canva design exists for the picture the post shows now. */
  hasDesign: boolean;
  /** The post is showing an edit brought back from Canva. */
  usingCanva: boolean;
  /** Links from the design that was just made or opened. */
  opened: { editUrl: string; slides: { page: number; editUrl: string }[] } | null;
  busy: "open" | "back" | "restore" | null;
  error: string | null;
  onOpen: () => void;
  onBringBack: () => void;
  onUseOriginal: () => void;
};

/** The Canva button and its small panel. Presentational; `CanvaEditButton` wires it. */
export function CanvaPanel(props: CanvaPanelProps) {
  const { variant = "button", mode, busy, opened, hasDesign, usingCanva, error } = props;
  const slides = opened && opened.slides.length > 1 ? opened.slides : null;
  const about = !mode
    ? "Opens in Canva with text and elements you can change."
    : mode === "flat_image"
      ? "Canva opened this as one picture, so the text inside it can't be changed there."
      : props.slideCount > 1 && mode === "magic_layers"
        ? "Each slide is its own Canva design, with text and elements you can change."
        : "Text and elements can be changed in Canva.";

  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        {variant === "tool" ? (
          <button
            type="button"
            aria-label="Edit in Canva"
            title="Edit in Canva"
            className={cn(
              "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 data-[state=open]:bg-surface-2 sm:px-2.5",
              props.className,
            )}
          >
            <CanvaMark className="size-4" />
            <span className="hidden sm:inline">Canva</span>
            {usingCanva ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
          </button>
        ) : (
          <Button variant="outline" className={props.className}>
            <CanvaMark className="!size-4" />
            Edit in Canva
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="w-[min(19rem,calc(100vw-1.5rem))] p-3.5"
      >
        <div className="flex items-start gap-2.5">
          <CanvaMark className="mt-0.5 size-8" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Edit in Canva</p>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{about}</p>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          {slides ? (
            <div>
              <p className="mb-1.5 text-xs font-medium text-foreground">Open a slide</p>
              <div className="grid grid-cols-6 gap-1.5">
                {slides.map((slide) => (
                  <a
                    key={slide.page}
                    href={slide.editUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open slide ${slide.page} in Canva`}
                    className="grid h-9 place-items-center rounded-xl border border-border bg-surface-2 text-xs font-medium text-foreground transition-colors hover:border-primary/60 hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                  >
                    {slide.page}
                  </a>
                ))}
              </div>
            </div>
          ) : opened ? (
            <Button asChild className="w-full">
              <a href={opened.editUrl} target="_blank" rel="noopener noreferrer">
                Open in Canva
              </a>
            </Button>
          ) : (
            <Button className="w-full" disabled={!!busy} onClick={props.onOpen}>
              {busy === "open" ? <Spinner className="animate-spin" /> : null}
              {busy === "open"
                ? "Getting it ready…"
                : hasDesign
                  ? "Open in Canva"
                  : "Make it editable in Canva"}
            </Button>
          )}
          {busy === "open" && !hasDesign ? (
            <p className="text-center text-xs text-muted-foreground">
              This takes about a minute. Keep this open.
            </p>
          ) : null}

          {hasDesign ? (
            <Button
              variant="outline"
              className="w-full"
              disabled={!!busy}
              onClick={props.onBringBack}
            >
              {busy === "back" ? <Spinner className="animate-spin" /> : <CornerDownLeft />}
              {busy === "back" ? "Bringing it back…" : "Bring back my edit"}
            </Button>
          ) : null}
        </div>

        {hasDesign && !usingCanva && !error ? (
          <p className="mt-2 text-xs leading-snug text-muted-foreground">
            Done in Canva? Bring your edit back and the post will use it.
          </p>
        ) : null}

        {usingCanva ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-xl bg-surface-2 py-1.5 pl-3 pr-1.5">
            <span className="flex min-w-0 items-center gap-2 text-xs text-foreground">
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
              <span className="truncate">Using your Canva edit</span>
            </span>
            <button
              type="button"
              disabled={!!busy}
              onClick={props.onUseOriginal}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55 disabled:opacity-50 [&_svg]:size-3"
            >
              {busy === "restore" ? <Spinner className="animate-spin" /> : <RotateCcw />}
              Use original
            </button>
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 text-xs leading-snug text-destructive">
            {error}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

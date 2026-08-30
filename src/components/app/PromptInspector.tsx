import { useMemo, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, Info, Sparkles, FileText as CopyIcon } from "@/components/brand/icons";
import { cn } from "@/lib/utils";
import { buildImagePromptDetailed, type BrandDnaLite, type ImgSize } from "@/lib/post-image";
import type { PlatformId } from "@/lib/social-platforms";

type Props = {
  postBody: string;
  postTitle?: string | null;
  brand: BrandDnaLite | null;
  workspaceName?: string | null;
  platform?: PlatformId | null;
  size: ImgSize;
  seedKey: string;
  autoSize?: boolean;
  className?: string;
  /** Compact = icon-only trigger (for approval cards). Default shows "Inspect" label. */
  compact?: boolean;
};

/**
 * Prompt Inspector — reveals which Brand DNA fields, style tokens, and
 * platform hints fed into the current post image so users can audit and
 * tune what Ravi is actually looking at.
 */
export function PromptInspector({
  postBody,
  postTitle,
  brand,
  workspaceName,
  platform,
  size,
  seedKey,
  autoSize,
  className,
  compact = false,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const inspection = useMemo(
    () =>
      buildImagePromptDetailed({
        postBody,
        postTitle,
        brand,
        workspaceName,
        platform,
        size,
        seedKey,
        autoSize,
      }),
    [postBody, postTitle, brand, workspaceName, platform, size, seedKey, autoSize],
  );

  const usedFields = inspection.brandFields.filter((f) => f.used);
  const missingFields = inspection.brandFields.filter((f) => !f.used);
  const { palette, composition, typographyDescription, typographyFamily } = inspection.visual;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(inspection.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {}
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 gap-1.5 rounded-full px-2 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground",
            className,
          )}
          aria-label="Inspect the prompt used for this image"
        >
          <Info className="h-3 w-3" strokeWidth={2.25} />
          {!compact && <span>Inspect prompt</span>}
        </Button>
      </PopoverTrigger>

      <PopoverContent
        side="bottom"
        align="end"
        className="w-[min(92vw,420px)] max-h-[70vh] overflow-y-auto p-0 shadow-xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Sparkles className="h-3 w-3 text-brand-green" strokeWidth={2.5} />
              Prompt inspector
            </div>
            <div className="mt-0.5 truncate text-[13px] font-semibold text-foreground">
              {inspection.brandName}
            </div>
          </div>
          <div className="shrink-0 rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-mono tabular-nums text-muted-foreground">
            {usedFields.length}/{inspection.brandFields.length} DNA
          </div>
        </div>

        {/* Style tokens */}
        <section className="px-4 pt-3">
          <SectionHeading>Style tokens</SectionHeading>
          <div className="mt-2 space-y-2.5">
            <div>
              <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Palette · {palette.label}
              </div>
              <div className="flex items-center gap-1.5">
                {[palette.bg, palette.surface, palette.fg, palette.muted, palette.accent].map(
                  (hex, i) => (
                    <div key={i} className="flex flex-col items-center gap-0.5">
                      <span
                        className="h-6 w-6 rounded-md border border-border/40 shadow-sm"
                        style={{ background: hex }}
                        aria-hidden
                      />
                      <span className="font-mono text-[9px] leading-none text-muted-foreground/80">
                        {hex.replace("#", "")}
                      </span>
                    </div>
                  ),
                )}
              </div>
            </div>

            <TokenRow label="Composition" value={composition} />
            <TokenRow
              label="Typography"
              value={typographyDescription}
              hint={typographyFamily.split(",")[0].replace(/"/g, "").trim()}
            />
            <TokenRow label="Aspect" value={inspection.aspectLine} />
            <TokenRow label="Platform" value={inspection.platformLine} />
            <div className="pt-0.5 text-[10px] font-mono text-muted-foreground/70">
              anchor: <span className="font-mono">{inspection.styleSeed}</span> · size:{" "}
              {inspection.size}
              {inspection.autoSize ? " · auto" : ""}
            </div>
          </div>
        </section>

        {/* Brand DNA fields used */}
        <section className="px-4 pt-4">
          <SectionHeading>Brand DNA fields used</SectionHeading>
          <ul className="mt-2 space-y-1.5">
            {usedFields.map((f) => (
              <li
                key={f.key}
                className="flex items-start gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5"
              >
                <span
                  className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-green"
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70">
                    {f.label}
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-foreground/85">
                    {f.value}
                  </div>
                </div>
              </li>
            ))}
            {usedFields.length === 0 && (
              <li className="rounded-lg border border-dashed border-border/60 bg-card/40 px-2.5 py-2 text-[11.5px] text-muted-foreground">
                No Brand DNA fields set — the image will fall back to generic styling.
              </li>
            )}
          </ul>

          {missingFields.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
                Missing:
              </span>
              {missingFields.map((f) => (
                <span
                  key={f.key}
                  className="rounded-full border border-dashed border-border/60 px-1.5 py-0.5 text-[10px] text-muted-foreground/80"
                >
                  {f.label}
                </span>
              ))}
            </div>
          )}
        </section>

        {/* Post signal */}
        <section className="px-4 pt-4">
          <SectionHeading>Post signal</SectionHeading>
          <div className="mt-2 space-y-1.5">
            {inspection.hook && (
              <div className="rounded-lg bg-secondary/40 px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70">
                  Hook
                </div>
                <div className="mt-0.5 line-clamp-2 text-[12px] italic leading-snug text-foreground/85">
                  “{inspection.hook}”
                </div>
              </div>
            )}
            <div className="rounded-lg bg-secondary/40 px-2.5 py-1.5">
              <div className="text-[10.5px] font-semibold uppercase tracking-wide text-foreground/70">
                Copy snippet
              </div>
              <div className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-foreground/85">
                {inspection.snippet || "—"}
              </div>
            </div>
          </div>
        </section>

        {/* Actions */}
        <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-2 border-t border-border/60 bg-background/95 px-4 py-2.5 backdrop-blur">
          <span className="text-[10.5px] text-muted-foreground">
            {inspection.prompt.length.toLocaleString()} chars
          </span>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1.5 rounded-full px-2.5 text-[11.5px]"
            onClick={copyPrompt}
          >
            {copied ? (
              <Check className="h-3 w-3 text-brand-green" strokeWidth={2.5} />
            ) : (
              <CopyIcon className="h-3 w-3" strokeWidth={2.25} />
            )}
            {copied ? "Copied" : "Copy full prompt"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {children}
    </h4>
  );
}

function TokenRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>
        {hint && (
          <span className="rounded-full bg-secondary/70 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {hint}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[12px] leading-snug text-foreground/85">{value}</div>
    </div>
  );
}

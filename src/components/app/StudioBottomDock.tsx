import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { MoreHorizontal, Sparkles } from "@/components/ui/gemini-icons";
import { STUDIO_TILES, type CanvasType } from "@/lib/studio";
import { TINT_HEX } from "@/components/app/StudioRail";
import { StudioRail } from "@/components/app/StudioRail";

function openCanvas(type: CanvasType) {
  window.dispatchEvent(new CustomEvent("open:canvas", { detail: { type } }));
}

export function StudioBottomDock() {
  const [open, setOpen] = useState(false);
  const pending = 0;

  return (
    <div className="lg:hidden shrink-0 border-t border-border/60 bg-sidebar/85 backdrop-blur-xl pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-center gap-1.5 overflow-x-auto px-2 py-2 scrollbar-none">
        {STUDIO_TILES.map((t, idx) => {
          const Icon = t.icon;
          const color = TINT_HEX[t.tint] ?? "#3b82f6";
          return (
            <button
              key={t.id}
              onClick={() => openCanvas(t.id)}
              style={{ animationDelay: `${idx * 40}ms` }}
              className="group animate-slide-in flex shrink-0 items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-2.5 py-1.5 text-[11.5px] font-medium text-foreground/85 transition-all duration-200 hover:-translate-y-0.5 hover:border-border hover:bg-card hover:text-foreground hover:shadow-[0_8px_20px_-10px_hsl(var(--brand-green)/0.4)] active:scale-[0.97]"
            >
              <span
                className="grid h-5 w-5 place-items-center rounded-full transition-transform duration-200 group-hover:scale-110 group-hover:rotate-[6deg]"
                style={{
                  background: `linear-gradient(135deg, ${color}22, ${color}08)`,
                  boxShadow: `inset 0 0 0 1px ${color}1a`,
                }}
              >
                <Icon className="h-3 w-3" strokeWidth={2.25} style={{ color }} />
              </span>
              <span className="whitespace-nowrap">{t.label}</span>
            </button>
          );
        })}

        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              className="group relative ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full px-[1.5px] py-[1.5px] text-[11.5px] font-semibold text-background transition-transform duration-200 hover:-translate-y-px active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--brand-green))] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              aria-label="Open Studio"
              style={{
                backgroundImage:
                  "linear-gradient(135deg, hsl(var(--brand-green)) 0%, hsl(var(--brand-green)) 45%, hsl(var(--brand-blue)) 100%)",
                boxShadow:
                  "0 6px 18px -6px hsl(var(--brand-green) / 0.55), 0 2px 6px -2px hsl(var(--brand-blue) / 0.35)",
              }}
            >
              <span className="relative inline-flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1.5 text-foreground backdrop-blur-md transition-colors group-hover:bg-background/70">
                <span
                  className="grid h-4 w-4 place-items-center rounded-full text-background"
                  style={{
                    backgroundImage:
                      "linear-gradient(135deg, hsl(var(--brand-green)), hsl(var(--brand-blue)))",
                    boxShadow: "0 0 10px hsl(var(--brand-green) / 0.55)",
                  }}
                >
                  <Sparkles className="h-2.5 w-2.5" strokeWidth={2.5} />
                </span>
                <span className="bg-gradient-to-r from-[hsl(var(--brand-green))] to-[hsl(var(--brand-blue))] bg-clip-text text-transparent">
                  Studio
                </span>
                {pending > 0 && (
                  <span className="grid h-4 min-w-4 animate-pulse place-items-center rounded-full bg-[hsl(var(--brand-green))] px-1 text-[9px] font-bold text-background shadow-[0_0_8px_hsl(var(--brand-green)/0.7)]">
                    {pending}
                  </span>
                )}
              </span>
            </button>
          </SheetTrigger>
          <SheetContent side="bottom" className="h-[80vh] p-0 bg-sidebar border-t border-border">
            <VisuallyHidden>
              <SheetTitle>Studio</SheetTitle>
              <SheetDescription>Creator tiles and queues</SheetDescription>
            </VisuallyHidden>
            <div className="h-full overflow-hidden">
              {/* Reuse the full StudioRail; override its hidden lg:flex via a wrapper */}
              <div className="h-full [&_aside]:!flex [&_aside]:!w-full [&_aside]:!py-0 [&_aside]:!pr-0 [&_aside]:!pl-0">
                <StudioRail />
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

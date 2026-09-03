"use client";

import { useState } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { Building2, Rocket, Loader2, Check, Sparkles } from "@/components/ui/gemini-icons";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { Persona } from "@/hooks/use-persona";

type Option = {
  id: Persona;
  title: string;
  tagline: string;
  Icon: React.ComponentType<{ className?: string }>;
  gradient: string;
};

const OPTIONS: Option[] = [
  {
    id: "founder",
    title: "Startup",
    tagline: "I run my own brand.",
    Icon: Rocket,
    gradient: "from-emerald-500/25 via-emerald-500/10 to-transparent",
  },
  {
    id: "agency",
    title: "Agency",
    tagline: "I serve multiple clients.",
    Icon: Building2,
    gradient: "from-fuchsia-500/25 via-fuchsia-500/10 to-transparent",
  },
];

export function PersonaDialog({
  open,
  onConfirm,
}: {
  open: boolean;
  onConfirm: (p: Persona) => Promise<void>;
}) {
  const [saving, setSaving] = useState<Persona | null>(null);
  const [saved, setSaved] = useState(false);

  const pick = async (p: Persona) => {
    if (saving || saved) return;
    setSaving(p);
    try {
      await onConfirm(p);
      setSaved(true);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't save. Try again.");
      setSaving(null);
    }
  };

  return (
    <AppModalShell
      open={open}
      onOpenChange={() => {
        /* forced */
      }}
      size="sm"
      Icon={Sparkles}
      eyebrow="Welcome"
      title="Which best describes you?"
      description="Pick one — we'll tune Raval AI to how you work."
      srDescription="Choose your persona"
      hideClose
      disableClose
      bodyClassName="px-6 py-5"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((opt) => {
          const isSaving = saving === opt.id;
          const isSaved = saved && saving === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => pick(opt.id)}
              disabled={!!saving || saved}
              className={cn(
                "group relative flex h-full flex-col overflow-hidden rounded-2xl border p-5 text-left transition",
                "border-border/60 bg-card/60 hover:border-brand-green/70 hover:bg-brand-green/[0.04]",
                isSaving && "border-brand-green/70 bg-brand-green/[0.06]",
                !!saving && !isSaving && "opacity-50",
              )}
            >
              <div
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-40 transition-opacity group-hover:opacity-80",
                  opt.gradient,
                )}
              />
              <div className="relative flex items-center justify-between">
                <div className="grid h-10 w-10 place-items-center rounded-xl bg-background/70 ring-1 ring-border/70">
                  <opt.Icon className="h-[18px] w-[18px] text-foreground" />
                </div>
                {isSaving && !isSaved && (
                  <Loader2 className="h-4 w-4 animate-spin text-brand-green" />
                )}
                {isSaved && <Check className="h-4 w-4 text-brand-green" strokeWidth={3} />}
              </div>
              <div className="relative mt-4">
                <div className="text-[16px] font-semibold tracking-tight">{opt.title}</div>
                <p className="mt-1 text-[12.5px] text-muted-foreground">{opt.tagline}</p>
              </div>
            </button>
          );
        })}
      </div>
    </AppModalShell>
  );
}

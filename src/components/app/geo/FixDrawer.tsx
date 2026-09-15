"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Check, Copy, Wand } from "@/components/icons";
import { cn } from "@/lib/utils";
import type { FixRecipe } from "@/lib/geo/fix-recipes";
import type { FixSafety } from "@/lib/geo/types";
import { copyText, EASE, ghostBtn, SAFETY_META } from "./geo-ui";

export function FixDrawer({ recipe, safety }: { recipe: FixRecipe; safety?: FixSafety }) {
  const [copied, setCopied] = useState(false);
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.24, ease: EASE }}
      className="overflow-hidden"
    >
      <div className="mx-3.5 mb-3.5 rounded-xl border border-border/60 bg-gradient-to-b from-background/80 to-muted/20 shadow-[inset_0_1px_0_0_hsl(var(--foreground)/0.05),0_8px_24px_-16px_rgb(0_0_0/0.5)] transition-colors duration-200 hover:border-border p-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-foreground">
            <Wand className="h-3.5 w-3.5 text-primary" strokeWidth={2.2} />
            {recipe.title}
          </div>
          {safety && (
            <span className="text-[11.5px] text-muted-foreground" title={SAFETY_META[safety].hint}>
              · {SAFETY_META[safety].label}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{recipe.placement}</div>
        {recipe.steps && (
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[12.5px] leading-relaxed text-foreground/85">
            {recipe.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        )}
        {recipe.code && (
          <div className="relative mt-2">
            <pre className="max-h-64 overflow-auto rounded-lg border border-border/50 bg-card p-3 pr-20 text-[11.5px] leading-relaxed text-foreground/90">
              <code>{recipe.code}</code>
            </pre>
            <button
              type="button"
              onClick={async () => {
                if (recipe.code && (await copyText(recipe.code))) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }
              }}
              className={cn(ghostBtn, "absolute right-2 top-2 px-2 py-1 text-[11px]")}
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-success" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" /> Copy
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

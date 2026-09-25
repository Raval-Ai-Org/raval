"use client";
// Which style a draft was made with, and whether its text follows the style's
// mechanical rules (banned words, emoji, hashtags, length, casing). Free and
// instant: pure string checks in the browser, no model call.
import { useMemo } from "react";
import { checkWritingConformance, type Conformance } from "@/lib/brand-kit/conformance";
import { styleAppliesTo } from "@/lib/brand-kit/resolve";
import { useBrandKit } from "./hooks";
import { resolveView } from "./preview";

export function useStyleConformance(
  workspaceId: string | null,
  styleChoice: string | null | undefined,
  format: string,
  text: string | null | undefined,
): { styleId: string; name: string; result: Conformance } | null {
  const kit = useBrandKit(workspaceId);
  return useMemo(() => {
    const data = kit.data;
    if (!data || !text?.trim() || styleChoice === "none") return null;
    const explicit = styleChoice
      ? data.styles.find((s) => s.id === styleChoice && !s.archived)
      : undefined;
    const style = explicit ?? data.styles.find((s) => s.isDefault && !s.archived);
    if (!style) return null;
    const resolved = resolveView(style, data.dna);
    if (!explicit && !styleAppliesTo(resolved, format)) return null;
    const result = checkWritingConformance(text, resolved);
    // Nothing checkable (a style with no writing rules) — say nothing.
    if (!result.checked) return null;
    return { styleId: style.id, name: style.name, result };
  }, [kit.data, styleChoice, format, text]);
}

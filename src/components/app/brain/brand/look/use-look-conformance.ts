"use client";
// Does a draft follow the brand's mechanical writing rules (banned words,
// emoji, hashtags, length, casing)? Free and instant: pure string checks in the
// browser against the look saved on Brand DNA, no model call.
import { useMemo } from "react";
import { useBrandDna } from "@/hooks/use-brand-dna";
import { checkWritingConformance, type Conformance } from "@/lib/brand-look/conformance";
import { resolveLook } from "@/lib/brand-look/resolve";

export function useLookConformance(
  workspaceId: string | null,
  text: string | null | undefined,
): { result: Conformance } | null {
  const { dna } = useBrandDna(workspaceId);
  return useMemo(() => {
    if (!text?.trim()) return null;
    const result = checkWritingConformance(text, resolveLook(dna as never));
    // Nothing checkable (no writing rules set) — say nothing.
    if (!result.checked) return null;
    return { result };
  }, [dna, text]);
}

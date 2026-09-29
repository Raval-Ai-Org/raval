import type { PlatformId } from "@/lib/social-platforms";
import type { StudioJobOutput } from "./jobs";

/** Add only newly generated captions; the original post and visual stay intact. */
export function mergeAddedPlatforms(
  original: StudioJobOutput,
  generated: StudioJobOutput,
  requested: PlatformId[],
): StudioJobOutput {
  const existing = new Set(original.variants?.map((variant) => variant.platform) ?? []);
  const additions = (generated.variants ?? []).filter(
    (variant) => requested.includes(variant.platform) && !existing.has(variant.platform),
  );
  const missing = requested.filter(
    (platform) =>
      !existing.has(platform) && !additions.some((variant) => variant.platform === platform),
  );
  if (missing.length)
    throw new Error(`Couldn't create versions for ${missing.join(", ")}. Try again.`);
  return { ...original, variants: [...(original.variants ?? []), ...additions] };
}

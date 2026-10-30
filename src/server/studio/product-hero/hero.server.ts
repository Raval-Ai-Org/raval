// A product hero poster, ready to render (ADR-0040): the product cut out of
// its own photo (cutout.server.ts), a staging and a palette from the pure
// core (src/lib/studio/product-hero/), and the references the image model
// gets: the product first, then the poster being edited or the brand's
// earlier product posts for a series look.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { signAssetPath } from "@/server/assets/persist.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { planProductHero, type HeroProduct } from "@/lib/studio/product-hero/plan";
import { productPalette, type ProductPalette } from "@/lib/studio/product-hero/palette";
import { heroCopyLines, productHeroPrompt } from "@/lib/studio/product-hero/prompt";
import type { StagingId } from "@/lib/studio/product-hero/stagings";
import { OCCASIONS, type HeroLook } from "@/lib/studio/product-hero/variety";
import { seriesPaths } from "../photo-design/design.server";
import type { StudioReference } from "../references.server";
import { ensureProductCutout } from "./cutout.server";

/** `assets.metadata.source` of a finished product poster. */
export const PRODUCT_HERO_SOURCE = "studio_product_hero";

/** What a render task keeps, so a repair or an edit is made the same way. */
export type ProductHeroTask = {
  productId: string;
  sourceAssetId: string;
  cutoutAssetId: string | null;
  /** The product reference (the cut-out, or the photo when there is none). */
  productPath: string;
  /**
   * In order: the poster being edited, the product, its original photo, then
   * earlier posts. Workspace paths, signed again for each render.
   */
  referencePaths: string[];
  staging: StagingId;
  palette: ProductPalette;
  /** The exact words set on the poster, for the visual review. */
  words: string[];
};

export type PreparedProductHero = {
  prompt: string;
  references: string[];
  task: ProductHeroTask;
};

export async function productHeroReferences(
  task: Pick<ProductHeroTask, "referencePaths">,
  workspaceId: string,
): Promise<string[]> {
  const signed = await Promise.all(
    task.referencePaths
      .filter((path) => isWorkspaceStoragePath(path, workspaceId))
      .map((path) => signAssetPath(path)),
  );
  return signed.filter((url): url is string => !!url);
}

export async function prepareProductHero(args: {
  client: SupabaseClient;
  workspaceId: string;
  product: HeroProduct & { id: string };
  /** The product's main photo, checked against the workspace. */
  photo: StudioReference;
  seed: string;
  brief: string;
  headline?: string | null;
  /** The look decided when the words were written (planHeroLook): followed as is. */
  look?: HeroLook | null;
  noWords?: boolean;
  recent: readonly string[];
  lean?: { liked: string[]; avoided: string[] } | null;
  /** An edit keeps the staging it had. */
  keepStaging?: string | null;
  /** An edit starts from the poster it changes (a workspace path). */
  previousRenderPath?: string | null;
  brand: {
    brandName: string;
    brandContext?: string | null;
    lookBlock?: string | null;
    fonts?: readonly string[];
    colours?: readonly string[];
    visualTasteRules?: string | readonly string[] | null;
    logoCorner?: string | null;
  };
  revision?: string | null;
  novelty?: string | null;
  tasteReferences?: readonly string[];
}): Promise<PreparedProductHero> {
  const cutout = await ensureProductCutout({
    client: args.client,
    workspaceId: args.workspaceId,
    productId: args.product.id,
    productName: args.product.name,
    photo: args.photo,
  });
  const plan = planProductHero({
    seed: args.seed,
    brief: args.brief,
    product: args.product,
    headline: args.headline,
    noWords: args.noWords,
    recent: args.recent,
    lean: args.lean,
    keepStaging: args.keepStaging ?? args.look?.staging,
    cropped: cutout?.cropped,
  });
  const look = args.look ?? plan.look;
  // A product its photo cuts off is only staged where it can enter from the
  // frame's edge (CROP_SAFE); the plan swaps any other staging for one.
  const staging = plan.staging;
  const palette = productPalette({
    product: cutout?.colour ?? null,
    brandColours: args.brand.colours,
    mood: look.palette,
  });
  const copy = {
    headline: look.headline ?? plan.copy.headline,
    support: look.support ?? plan.copy.support,
    benefits: look.benefits?.length ? look.benefits : plan.copy.benefits,
  };
  const productPath = cutout?.storagePath ?? args.photo.storagePath;
  const previous =
    args.previousRenderPath && isWorkspaceStoragePath(args.previousRenderPath, args.workspaceId)
      ? args.previousRenderPath
      : null;
  const series = previous
    ? []
    : await seriesPaths(args.client, args.workspaceId, [PRODUCT_HERO_SOURCE]);
  // The cut-out leads; the original photo follows as the truth for the label.
  const original = cutout ? [args.photo.storagePath] : [];
  const referencePaths = [
    ...(previous ? [previous] : []),
    productPath,
    ...original,
    ...series,
  ].slice(0, 4);
  const prompt = [
    productHeroPrompt({
      staging,
      palette,
      productName: args.product.name,
      texture: plan.texture,
      ingredients: plan.ingredients,
      copy,
      look: staging.id === look.staging ? look : { ...look, set: undefined },
      occasion: OCCASIONS.find((o) => o.id === look.occasion) ?? null,
      allowText: plan.allowText,
      cutout: !!cutout,
      cropped: cutout?.cropped,
      original: original.length > 0,
      series: series.length > 0,
      brandName: args.brand.brandName,
      brandContext: args.brand.brandContext,
      lookBlock: args.brand.lookBlock,
      fonts: args.brand.fonts,
      visualTasteRules: args.brand.visualTasteRules,
      logoCorner: args.brand.logoCorner,
      revision: args.revision,
      novelty: args.novelty,
      emphasisSeed: args.seed,
    }),
    previous
      ? "EDIT: the first reference image is the current poster; the product's references follow it. Keep the poster and change only what the revision asks; the product stays exactly as in its references."
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const signed = await productHeroReferences({ referencePaths }, args.workspaceId);
  return {
    prompt,
    references: [...new Set([...signed, ...(args.tasteReferences ?? [])])].slice(0, 4),
    task: {
      productId: args.product.id,
      sourceAssetId: args.photo.id,
      cutoutAssetId: cutout?.assetId ?? null,
      productPath,
      referencePaths,
      staging: staging.id,
      palette,
      words: plan.allowText ? heroCopyLines(copy, staging).map((l) => l.text) : [],
    },
  };
}

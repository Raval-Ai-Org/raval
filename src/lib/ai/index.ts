// Public AI surface. Import from here rather than the individual files
// so future refactors (renaming, splitting, provider swaps) touch one place.

import "server-only";
export {
  runJsonPrompt,
  runStructuredPrompt,
  runTool,
  AiGatewayError,
  AiOutputError,
  type RunJsonOpts,
  type RunToolOpts,
} from "./run.server";

export {
  chatCompletion,
  chatCompletionStream,
  extractionCompletion,
  EXTRACTION_MODEL,
} from "@/lib/ai-gateway.server";

export {
  imageGenerationStream,
  KieGatewayError,
  type GeneratedMedia,
  type GeneratedVideo,
} from "@/lib/kie-gateway.server";

export {
  serializeBrandContext,
  compactBrandTagline,
  type BrandCtxDna,
  type BrandCtxOpts,
  type BrandCtxSignals,
} from "./brand-context";

export {
  getWorkspaceSignals,
  invalidateWorkspaceSignals,
  type WorkspaceSignals,
} from "./workspace-signals.server";

export { safeParseJson, extractFirstJsonObject, stripJsonFences } from "./json";
export * from "./prompts";

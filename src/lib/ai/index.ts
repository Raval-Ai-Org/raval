// Public AI surface. Import from here rather than the individual files
// so future refactors (renaming, splitting, provider swaps) touch one place.

export {
  runJsonPrompt,
  runTool,
  AiGatewayError,
  type RunJsonOpts,
  type RunToolOpts,
} from "./run.server";

export {
  chatCompletion,
  chatCompletionStream,
  extractionCompletion,
  imageGenerationStream,
  EXTRACTION_MODEL,
} from "@/lib/ai-gateway.server";

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
export { logAiCall, readTokenLog, type TokenLogEntry } from "./token-log.server";
export * from "./prompts";

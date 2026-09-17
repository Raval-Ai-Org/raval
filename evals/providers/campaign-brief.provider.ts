// campaign-brief.provider.ts — a promptfoo custom provider that calls the
// REAL production brief-generation function
// (src/server/research/campaign-brief.server.ts), not a re-implementation.
// See competitor-intel.provider.ts for the loading/path-alias notes.
import { generateCampaignBrief, type BrandContext } from "@/server/research/campaign-brief.server";

type Vars = {
  brand: BrandContext;
  goal: string;
  channels: string[];
};

export default class CampaignBriefProvider {
  id() {
    return "campaign-brief-generation";
  }

  async callApi(_prompt: string, context?: { vars: Record<string, unknown> }) {
    const vars = (context?.vars ?? {}) as Vars;
    try {
      const result = await generateCampaignBrief(vars.brand, vars.goal, vars.channels);
      return { output: result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

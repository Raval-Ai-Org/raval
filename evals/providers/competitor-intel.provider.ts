// competitor-intel.provider.ts — a promptfoo custom provider that calls the
// REAL production synthesis function (src/server/research/competitor-intel.server.ts),
// not a re-implementation, so evals exercise the exact prompt/schema shipped
// in the app. Loaded by promptfoo via `file://evals/providers/competitor-intel.provider.ts`
// — promptfoo runs .ts providers directly in Node with tsconfig.json path-alias
// resolution, as long as `promptfoo eval` runs from the repo root.
import { synthesizeCompetitorProfile } from "@/server/research/competitor-intel.server";

type Page = { url: string; markdown: string; links: string[] };

type Vars = {
  input: { url: string; pages: Page[] };
};

export default class CompetitorIntelProvider {
  id() {
    return "competitor-intel-synthesis";
  }

  async callApi(_prompt: string, context?: { vars: Record<string, unknown> }) {
    const vars = (context?.vars ?? {}) as Vars;
    try {
      const result = await synthesizeCompetitorProfile(vars.input.url, vars.input.pages);
      return { output: result };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }
}

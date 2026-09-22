// output-schemas.ts — JSON Schemas for Claude structured output
// (output_config.format). A schema-constrained answer is valid JSON by
// construction, so these routes need no parse-repair call. Only the subset the
// API supports: no string-length or numeric constraints, additionalProperties
// false, every property required (use "" / [] for unknown values).

const str = { type: "string" } as const;
const strList = { type: "array", items: str } as const;

function object(properties: Record<string, unknown>) {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required: Object.keys(properties),
  };
}

export const BRAND_EXTRACT_OUTPUT_SCHEMA = object({
  brandName: str,
  oneLiner: str,
  about: str,
  industry: str,
  businessModel: str,
  audience: str,
  voice: str,
  values: str,
  products: str,
  doRules: str,
  dontRules: str,
  mission: str,
  vision: str,
  positioning: str,
  uniqueValueProp: str,
  audienceTags: strList,
  valueTags: strList,
  keywords: strList,
  colors: { type: "array", items: object({ name: str, hex: str }) },
  fonts: strList,
  competitors: {
    type: "array",
    items: object({
      name: str,
      url: str,
      positioning: str,
      strengths: str,
      weaknesses: str,
      notes: str,
    }),
  },
  customerSignals: object({
    jobsToBeDone: str,
    painPoints: str,
    objections: str,
    buyingTriggers: str,
    decisionCriteria: str,
    channels: str,
    feedback: str,
  }),
  insights: { type: "array", items: object({ title: str, body: str }) },
  missing: strList,
});

export const CAMPAIGN_BRIEF_OUTPUT_SCHEMA = object({
  theme: str,
  keyMessage: str,
  targetAudience: str,
  callToAction: str,
  contentIdeas: {
    type: "array",
    items: object({ channel: str, idea: str, hook: str }),
  },
});

export const COMPETITOR_INTEL_OUTPUT_SCHEMA = object({
  // "Who are they / what do they do" — the questions the Competitors surface
  // has to answer on the card, before any strategic interpretation.
  summary: str,
  products: strList,
  targetCustomers: str,
  companyFacts: strList,
  positioning: str,
  strengths: strList,
  weaknesses: strList,
  targetAudience: str,
  pricingSignals: str,
  differentiators: strList,
  contentThemes: strList,
  evidence: {
    type: "array",
    items: object({ claim: str, source: str }),
  },
});

// Competitor discovery: the model only ever *classifies* candidates that a
// web search actually returned, so every property is about a company already
// named in the evidence. "unknown" and 0 confidence are the honest answers
// when the snippets do not support a judgement.
export const COMPETITOR_DISCOVERY_OUTPUT_SCHEMA = object({
  competitors: {
    type: "array",
    items: object({
      name: str,
      domain: str,
      relationship: { type: "string", enum: ["direct", "indirect", "alternative", "unknown"] },
      confidence: { type: "number" },
      rationale: str,
      whatTheyDo: str,
    }),
  },
});

// The "what changed recently" filter. The model decides which of the supplied
// news items is a real, meaningful move and which is noise; it never writes an
// item that was not in the evidence.
export const COMPETITOR_UPDATES_OUTPUT_SCHEMA = object({
  updates: {
    type: "array",
    items: object({
      sourceIndex: { type: "number" },
      kind: {
        type: "string",
        enum: ["launch", "pricing", "positioning", "funding", "campaign", "content"],
      },
      significance: { type: "string", enum: ["major", "notable"] },
      title: str,
      summary: str,
    }),
  },
});

export const COACH_INTENTS = [
  "geo-audit",
  "brand-dna",
  "plan-week",
  "schedule",
  "review-drafts",
  "seo-brief",
  "share",
  "ideate",
  "social",
  "email",
  "blog",
  "competitor",
  "market",
] as const;

const coachAction = object({
  label: str,
  prompt: str,
  intent: { type: "string", enum: [...COACH_INTENTS] },
});

const coachItems = {
  type: "array",
  items: object({
    title: str,
    detail: str,
    tone: { type: "string", enum: ["positive", "warning", "neutral", "opportunity"] },
    action: coachAction,
    source: str,
  }),
};

export const COACH_OUTPUT_SCHEMA = object({
  greeting: str,
  headline: str,
  focus: object({ title: str, why: str, action: coachAction }),
  wins: coachItems,
  risks: coachItems,
  competitors: coachItems,
  market: coachItems,
  plays: coachItems,
  weekPlan: strList,
});

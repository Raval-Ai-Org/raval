import { useEffect, useState } from "react";
import { buildDesignMd, saveDesignMd } from "@/lib/design-md";

export interface BrandColor {
  name: string;
  hex: string;
}
export interface BrandSocial {
  platform: string;
  url: string;
}
export interface BrandSource {
  label: string;
  snippet?: string;
  url?: string;
}

export type ExtractStatus = "idle" | "loading" | "ok" | "error";

export interface Competitor {
  id: string;
  name: string;
  url?: string;
  positioning?: string;
  strengths?: string;
  weaknesses?: string;
  pricing?: string;
  notes?: string;
}

export interface Persona {
  id: string;
  name: string;
  role?: string;
  segment?: string;
  goals?: string;
  painPoints?: string;
  objections?: string;
  channels?: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  author?: string;
  role?: string;
  source?: string;
}

export interface AssetItem {
  id: string;
  label: string;
  url: string;
  kind?: "logo" | "image" | "doc" | "design" | "video" | "link";
  notes?: string;
}

export interface MemoryNote {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  source?: "user" | "chat" | "manual";
}

export interface SignalEvidence {
  id: string;
  text: string;
  sourceLabel?: string;
  sourceUrl?: string;
  capturedAt?: number;
}

export interface CustomerSignals {
  jobsToBeDone: string;
  painPoints: string;
  objections: string;
  buyingTriggers: string;
  decisionCriteria: string;
  channels: string;
  feedback: string;
  testimonials: Testimonial[];
  personas: Persona[];
  triggerSignals: SignalEvidence[];
  objectionSignals: SignalEvidence[];
  feedbackSources: SignalEvidence[];
}

export interface BrandDna {
  brandName: string;
  oneLiner: string;
  about: string;
  industry: string;
  businessModel: string;
  voice: string;
  audience: string;
  values: string;
  products: string;
  doRules: string;
  dontRules: string;
  audienceTags: string[];
  valueTags: string[];
  colors: BrandColor[];
  fonts: string[];
  logoUrl: string | null;
  faviconUrl: string | null;
  websiteUrl: string | null;
  socials: BrandSocial[];
  missing: string[];
  /** Per-field provenance: where the value came from (e.g. "og:site_name", "theme-color meta", "homepage H1"). */
  sources: Record<string, BrandSource>;
  status: ExtractStatus;
  lastError: string | null;
  extractedAt: number | null;
  updatedAt: number;
  // Extended memory
  competitors: Competitor[];
  customer: CustomerSignals;
  assets: AssetItem[];
  notes: MemoryNote[];
  mission: string;
  vision: string;
  positioning: string;
  uniqueValueProp: string;
  keywords: string[];
  userInsights: MemoryNote[];
  memoryLastMsgCount?: number;
  memoryUpdatedAt?: number;
}

export const emptyCustomer: CustomerSignals = {
  jobsToBeDone: "",
  painPoints: "",
  objections: "",
  buyingTriggers: "",
  decisionCriteria: "",
  channels: "",
  feedback: "",
  testimonials: [],
  personas: [],
  triggerSignals: [],
  objectionSignals: [],
  feedbackSources: [],
};

export const emptyDna: BrandDna = {
  brandName: "",
  oneLiner: "",
  about: "",
  industry: "",
  businessModel: "",
  voice: "",
  audience: "",
  values: "",
  products: "",
  doRules: "",
  dontRules: "",
  audienceTags: [],
  valueTags: [],
  colors: [],
  fonts: [],
  logoUrl: null,
  faviconUrl: null,
  websiteUrl: null,
  socials: [],
  missing: [],
  sources: {},
  status: "idle",
  lastError: null,
  extractedAt: null,
  updatedAt: 0,
  competitors: [],
  customer: emptyCustomer,
  assets: [],
  notes: [],
  mission: "",
  vision: "",
  positioning: "",
  uniqueValueProp: "",
  keywords: [],
  userInsights: [],
};

const TEXT_FIELDS: (keyof BrandDna)[] = [
  "brandName",
  "oneLiner",
  "about",
  "industry",
  "businessModel",
  "voice",
  "audience",
  "values",
  "products",
  "doRules",
  "dontRules",
];

export function useBrandDna(workspaceId: string | null) {
  const key = workspaceId ? `brand-dna:v3:${workspaceId}` : null;
  const legacyKeys = workspaceId ? [`brand-dna:v2:${workspaceId}`, `brand-dna:${workspaceId}`] : [];
  const [dna, setDna] = useState<BrandDna>(emptyDna);

  useEffect(() => {
    if (!key) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        setDna({ ...emptyDna, ...JSON.parse(raw) });
        return;
      }
      for (const lk of legacyKeys) {
        const legacy = localStorage.getItem(lk);
        if (legacy) {
          setDna({ ...emptyDna, ...JSON.parse(legacy) });
          return;
        }
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const persist = (next: BrandDna) => {
    if (key) {
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
    }
    // Sync Design.md
    if (workspaceId) {
      try {
        saveDesignMd(workspaceId, buildDesignMd(next));
      } catch {}
    }
  };

  const save = (next: Partial<BrandDna>) => {
    const merged = { ...dna, ...next, updatedAt: Date.now() };
    setDna(merged);
    persist(merged);
  };

  const replace = (next: BrandDna) => {
    const merged = { ...next, updatedAt: Date.now() };
    setDna(merged);
    persist(merged);
  };

  const filled =
    TEXT_FIELDS.filter((f) => (dna[f] as string | undefined)?.toString().trim()).length +
    (dna.colors.length > 0 ? 1 : 0) +
    (dna.logoUrl ? 1 : 0) +
    (dna.audienceTags.length > 0 ? 1 : 0);
  const total = TEXT_FIELDS.length + 3;

  return { dna, save, replace, filledCount: filled, total };
}

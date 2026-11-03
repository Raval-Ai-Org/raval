// What the Campaigns screen is given and what it can ask for (ADR-0039).
// CampaignsScreen is presentational: CampaignsPanel wires these to the RPCs,
// /campaigns-lab to sample data.
import type {
  CampaignBriefInput,
  CampaignMedia,
  CampaignPiece,
  CampaignView,
  CampaignsHome,
} from "@/lib/campaigns/contracts";

export const CAMPAIGN_TABS = ["overview", "running", "drafts", "done"] as const;
export type CampaignsTab = (typeof CAMPAIGN_TABS)[number];

export type CampaignsMode =
  | { kind: "home" }
  | { kind: "campaign"; id: string }
  | {
      kind: "new";
      type?: string | null;
      prefill?: Partial<CampaignBriefInput> | null;
      editId?: string | null;
    };

export type ProductOption = { id: string; name: string; thumb: string | null };

export type CampaignsView = {
  home: CampaignsHome;
  /** The open campaign, when mode is "campaign". */
  selected: CampaignView | null;
  today: string;
  timezone: string;
  canEdit: boolean;
  products: ProductOption[];
  /** Preview links for uploaded photos and clips, by asset id. */
  mediaUrls: Record<string, string>;
  /** Which action is running ("plan:<id>", "start:<id>", "save"…), or null. */
  busy: string | null;
};

export type PiecePatch = Partial<
  Pick<CampaignPiece, "date" | "time" | "title" | "idea" | "visual" | "mediaIds">
>;

export type CampaignsHandlers = {
  go(mode: CampaignsMode): void;
  tab(tab: CampaignsTab): void;
  save(brief: CampaignBriefInput, id: string | null): Promise<CampaignView | null>;
  write(args: {
    type: string;
    name?: string;
    about?: string;
    productIds?: string[];
  }): Promise<{ name: string; about: string; keyMessage: string } | null>;
  plan(id: string): Promise<void>;
  start(id: string): void;
  pause(id: string, paused: boolean): void;
  end(id: string): void;
  count(id: string, count: number | null): void;
  editPiece(id: string, pieceId: string, patch: PiecePatch): void;
  remove(id: string): void;
  upload(files: File[]): Promise<CampaignMedia[]>;
  openCalendar(): void;
  openPiece(contentId: string): void;
  openAutopilot(): void;
};

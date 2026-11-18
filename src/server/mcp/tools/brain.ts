// The brand's brains, read only (ADR-0032, ADR-0033, ADR-0035): the Brain
// overview, the marketing strategy, products, goals, memory, what waits for a
// person and what is on its way out. Every tool calls the same server
// function the app does, with the person's own client, so RLS, flags and
// roles apply unchanged. Changing any of these stays a click in the app.
import "server-only";
import type { BrainOverview } from "@/lib/brain/brain";
import type { GoalsView } from "@/lib/goals/contracts";
import type { WorkspacePulse } from "@/lib/pulse/pulse";
import type { Product } from "@/lib/products/catalog";
import type { VisualView } from "@/lib/brand-visuals/contracts";
import { ownDesignLine } from "@/lib/brand-visuals/bible";
import { callFn } from "../bridge.server";
import type { McpTool } from "../tool";

const read = { scope: "workspace", minRole: "viewer", write: false } as const;

export const brainTools: McpTool[] = [
  {
    name: "get_brain_overview",
    title: "Brain overview",
    description:
      "What Mellox knows about the brand across Brand DNA, Audience, Competitors and Market: each brain's state, recent updates and what still needs a person. Free; starts no scan.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) =>
      callFn<BrainOverview>(caller, "brain", "getBrainOverview", { workspaceId }),
  },
  {
    name: "get_marketing_strategy",
    title: "Marketing strategy",
    description:
      "The workspace's marketing strategy (pillars, channels, pace, KPIs) and whether a person confirmed it. Only a confirmed strategy steers generation.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) =>
      callFn(caller, "strategy", "getStrategy", { workspaceId }),
  },
  {
    name: "list_products",
    title: "Products and services",
    description:
      "The brand's catalogue of products and services, in the team's order, with price, page, benefits and whether a photo exists. Use a product's id as productId when drafting a Studio piece.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) => {
      const products = await callFn<Product[]>(caller, "products", "listProducts", {
        workspaceId,
      });
      return {
        products: products
          .filter((p) => p.status === "active")
          .map((p) => ({
            productId: p.id,
            kind: p.kind,
            name: p.name,
            description: p.description,
            price: p.price || null,
            url: p.url,
            category: p.category || null,
            benefits: p.benefits,
            hasPhoto: p.images.length > 0,
          })),
      };
    },
  },
  {
    name: "get_brand_look",
    title: "Brand look (Inspo)",
    description:
      "How the brand's pictures are made: the design Mox learned from its website and posts (the Custom look), whether pictures follow it, the website screenshots it was read from and the Site art, product and people media in Inspo → Media with their asset ids. Free; starts no scan. Use a media assetId as referenceAssetIds when drafting a Studio piece.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) => {
      const view = await callFn<VisualView>(caller, "brand-visuals", "getVisualTaste", {
        workspaceId,
      });
      const active = view.profiles.find((p) => p.id === view.activeId);
      const direction = active?.profile.directions[active.profile.selected];
      const live = view.sources.filter((s) => s.status !== "removed");
      const folderOf = (region: Record<string, unknown>) =>
        typeof region.folder === "string" ? region.folder : null;
      return {
        customLook: direction ? { name: direction.name, design: ownDesignLine(direction) } : null,
        websiteScreenshots: live.filter(
          (s) =>
            s.kind === "website" &&
            ["full", "section", "art"].includes(String(s.region.type)) &&
            !s.region.mobile,
        ).length,
        media: live
          .filter(
            (s) =>
              s.status === "approved" &&
              (s.purpose === "element" || s.purpose === "product" || s.purpose === "person"),
          )
          .slice(0, 60)
          .map((s) => ({
            assetId: s.asset_id,
            kind: s.purpose === "element" ? "site-art" : s.purpose,
            label: s.notes?.trim() || s.label,
            folder: folderOf(s.region),
          })),
      };
    },
  },
  {
    name: "get_goals",
    title: "Goals",
    description:
      "The person's own goals for this brand (focus, target numbers, timeframe) and progress measured from posts that went out. Numbers Mellox can't read yet say not measured.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) =>
      callFn<GoalsView>(caller, "goals", "getGoals", { workspaceId }),
  },
  {
    name: "list_memories",
    title: "Brand memory",
    description:
      "The team's saved memories for this brand (rules, preferences, facts) that every generator follows. Read only; saving happens in chat or Settings → Memory.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) =>
      callFn(caller, "memory", "getMemory", { workspaceId }),
  },
  {
    name: "get_workspace_pulse",
    title: "What waits",
    description:
      "One free read of what waits for a person: posts to approve, Autopilot's state, running campaigns and their phase, products and the goal.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) => {
      const pulse = await callFn<WorkspacePulse>(caller, "pulse", "getWorkspacePulse", {
        workspaceId,
      });
      return {
        waiting: pulse.waiting,
        autopilot: pulse.autopilot,
        campaigns: pulse.campaigns,
        products: pulse.products,
        goal: pulse.goal,
        piecesMade: pulse.made?.total ?? null,
      };
    },
  },
  {
    name: "get_publish_queue",
    title: "Publish queue",
    description:
      "Approved and scheduled posts, articles and website pull requests on their way out. A list only: approving, scheduling and merging stay in the place that owns each row.",
    input: {},
    ...read,
    run: async ({ workspaceId }, { caller }) =>
      callFn(caller, "publish", "getPublishQueue", { workspaceId }),
  },
];

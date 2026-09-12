// Legacy canvas vocabulary — read-only compatibility for surfaces that still
// render content created before the Studio rebuild (the Agency dashboard's
// per-client feed). New code uses `@/lib/studio/formats`; nothing here creates
// content, and the retired formats (SEO brief, landing page, email) can only
// be viewed, approved, or discarded.
import {
  FileText,
  Image as ImageIcon,
  LayoutTemplate,
  Mail,
  Search,
  Share2,
  type LucideIcon,
} from "@/components/icons";

export type CanvasType =
  "social-post" | "seo-brief" | "landing-page" | "email" | "article" | "design-asset";

export type TileDef = {
  id: CanvasType;
  label: string;
  sub: string;
  icon: LucideIcon;
  /** Key into the Agency page's local tint map. */
  tint: string;
};

export const TILE_BY_ID: Record<CanvasType, TileDef> = {
  "social-post": {
    id: "social-post",
    label: "Social post",
    sub: "Posts",
    icon: Share2,
    tint: "brand-green",
  },
  "design-asset": {
    id: "design-asset",
    label: "Image post",
    sub: "Visuals",
    icon: ImageIcon,
    tint: "brand-green",
  },
  article: {
    id: "article",
    label: "Article",
    sub: "Long-form",
    icon: FileText,
    tint: "brand-green",
  },
  "seo-brief": {
    id: "seo-brief",
    label: "SEO brief (legacy)",
    sub: "Read-only",
    icon: Search,
    tint: "slate",
  },
  "landing-page": {
    id: "landing-page",
    label: "Landing page (legacy)",
    sub: "Read-only",
    icon: LayoutTemplate,
    tint: "slate",
  },
  email: { id: "email", label: "Email (legacy)", sub: "Read-only", icon: Mail, tint: "slate" },
};

export type QueueItem = {
  id: string;
  title: string;
  canvas: CanvasType;
  channel?: string;
  when?: string;
  progress?: number;
};

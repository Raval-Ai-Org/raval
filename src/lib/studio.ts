import {
  Share2,
  Search,
  LayoutTemplate,
  Mail,
  FileText,
  Palette,
  type LucideIcon,
} from "@/components/ui/gemini-icons";

export type CanvasType =
  "social-post" | "seo-brief" | "landing-page" | "email" | "article" | "design-asset";

export type TileDef = {
  id: CanvasType;
  label: string;
  sub: string;
  icon: LucideIcon;
  tint: string; // tailwind color name used in gradients
  beta?: boolean;
};

export const STUDIO_TILES: TileDef[] = [
  {
    id: "social-post",
    label: "Social Post",
    sub: "IG · X · LinkedIn",
    icon: Share2,
    tint: "brand-green",
  },
  { id: "seo-brief", label: "SEO Brief", sub: "SEO · AEO · GEO", icon: Search, tint: "sky" },
  {
    id: "landing-page",
    label: "Landing Page",
    sub: "Hero · CTA · sections",
    icon: LayoutTemplate,
    tint: "violet",
  },
  { id: "email", label: "Email", sub: "Newsletter · drip", icon: Mail, tint: "rose" },
  { id: "article", label: "Article", sub: "Blog · long-form", icon: FileText, tint: "teal" },
  {
    id: "design-asset",
    label: "Design",
    sub: "Creatives · brand kit",
    icon: Palette,
    tint: "fuchsia",
    beta: true,
  },
];

export const TILE_BY_ID: Record<CanvasType, TileDef> = STUDIO_TILES.reduce(
  (m, t) => ((m[t.id] = t), m),
  {} as Record<CanvasType, TileDef>,
);

/* ---------------- Mock queues ---------------- */

export type QueueItem = {
  id: string;
  title: string;
  canvas: CanvasType;
  channel?: string;
  when?: string; // relative label
  progress?: number; // 0..100
};

export const MOCK_APPROVALS: QueueItem[] = [
  { id: "a1", title: "Launch carousel · 5 slides", canvas: "social-post", channel: "LinkedIn" },
  { id: "a2", title: "AEO brief: 'best CRM for SMB'", canvas: "seo-brief", channel: "Site" },
  { id: "a3", title: "Weekly newsletter · issue 14", canvas: "email", channel: "Resend" },
];

export const MOCK_SCHEDULED: QueueItem[] = [
  {
    id: "s1",
    title: "Weekly newsletter — issue 14",
    canvas: "email",
    channel: "Resend",
    when: "Tomorrow · 9:00",
  },
  {
    id: "s2",
    title: "Product launch carousel",
    canvas: "social-post",
    channel: "Instagram",
    when: "Thu · 18:00",
  },
  {
    id: "s3",
    title: "AEO brief: 'best CRM for SMB'",
    canvas: "seo-brief",
    channel: "Site",
    when: "Fri · 11:00",
  },
  {
    id: "s4",
    title: "Landing page · pricing v2",
    canvas: "landing-page",
    channel: "Site",
    when: "Sat · 08:00",
  },
  {
    id: "s5",
    title: "How-to: onboarding in 60s",
    canvas: "article",
    channel: "Blog",
    when: "Mon · 07:00",
  },
];

export const MOCK_IN_PROGRESS: QueueItem[] = [
  { id: "p1", title: "Generating 6 social variants", canvas: "social-post", progress: 64 },
  { id: "p2", title: "Drafting Q3 pillar article", canvas: "article", progress: 32 },
];

export const MOCK_RECENT: QueueItem[] = [
  { id: "r1", title: "Hero redesign · v2", canvas: "landing-page", when: "2m ago" },
  { id: "r2", title: "X thread · launch teaser", canvas: "social-post", when: "18m ago" },
  { id: "r3", title: "LinkedIn carousel · v1", canvas: "social-post", when: "1h ago" },
  { id: "r4", title: "Email · cold sequence step 2", canvas: "email", when: "3h ago" },
  { id: "r5", title: "SEO brief · 'ai marketing os'", canvas: "seo-brief", when: "Yesterday" },
];

export const CANVAS_STEPS: { id: string; label: string }[] = [
  { id: "brief", label: "Brief" },
  { id: "generate", label: "Generate" },
  { id: "preview", label: "Preview" },
  { id: "schedule", label: "Schedule" },
];

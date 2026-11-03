// Channels' sections (sidebar → Grow → Channels). Pure; the URL's `?s=` picks one.

export type ChannelSection = "social" | "apps" | "website" | "analytics";

export const CHANNEL_SECTIONS: readonly { id: ChannelSection; label: string; subtitle: string }[] =
  [
    { id: "social", label: "Social", subtitle: "Where Mellox posts for this brand" },
    { id: "apps", label: "Apps", subtitle: "Design, email, ads and files" },
    { id: "website", label: "Website", subtitle: "Your site, its fixes and its blog" },
    { id: "analytics", label: "Analytics", subtitle: "Website and search numbers" },
  ];

export function parseChannelSection(value: string | null | undefined): ChannelSection {
  return CHANNEL_SECTIONS.some((s) => s.id === value) ? (value as ChannelSection) : "social";
}

"use client";

import { FileText, Mail } from "@/components/icons";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { cn } from "@/lib/utils";
import {
  channelInfo,
  STATUS_LABEL,
  type CalendarChannel,
  type CalendarStatus,
} from "@/lib/calendar/model";

const BRAND: Partial<Record<CalendarChannel, BrandKey>> = {
  instagram: "instagram",
  facebook: "facebook",
  linkedin: "linkedin",
  x: "x",
  threads: "threads",
  tiktok: "tiktok",
  youtube: "youtube",
};

export function ChannelIcon({
  channel,
  size = 14,
  brand = true,
}: {
  channel: CalendarChannel;
  size?: number;
  /** False draws the mark in the current text colour (on a coloured fill). */
  brand?: boolean;
}) {
  const key = BRAND[channel];
  if (key) return <BrandLogo name={key} brand={brand} size={size} />;
  const Icon = channel === "blog" ? FileText : Mail;
  return <Icon style={{ width: size, height: size }} strokeWidth={2} aria-hidden />;
}

/** The channel's mark on a soft tint of its own colour. */
export function ChannelBadge({ channel, size = 28 }: { channel: CalendarChannel; size?: number }) {
  const { color } = channelInfo(channel);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-lg"
      style={{ width: size, height: size, background: `${color}22`, color }}
    >
      <ChannelIcon channel={channel} size={Math.round(size * 0.5)} />
    </span>
  );
}

const STATUS_STYLE: Record<CalendarStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  review: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  scheduled: "bg-info/15 text-info",
  publishing: "bg-info/15 text-info",
  published: "bg-foreground/10 text-foreground",
  failed: "bg-destructive/15 text-destructive",
};

export function StatusChip({ status, className }: { status: CalendarStatus; className?: string }) {
  return (
    <span
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
        STATUS_STYLE[status],
        className,
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "9:00 AM" / "09:00", following the viewer's own locale. */
export function clock(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, h || 0, m || 0);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

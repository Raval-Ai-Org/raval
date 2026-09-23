"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useReducedMotion } from "framer-motion";
import { BrandLogo, type BrandKey } from "@/components/brand/BrandLogo";
import { FileText, Globe, Mail } from "@/components/icons";
import { onboardingPath, workspacePath } from "@/lib/workspace/paths";
import { cn } from "@/lib/utils";
import type { CcClient, HealthTone } from "@/lib/agency/command-center";

/* ------------------------------------------------------------------ */
/* Deep links into one client's workspace                              */
/* ------------------------------------------------------------------ */

export type ClientDestination =
  | "home"
  | "calendar"
  | "analytics"
  | "visibility"
  | "competitors"
  | "backlinks"
  | "accounts"
  | "brand";

export function clientHref(c: Pick<CcClient, "id" | "onboarded">, dest: ClientDestination): string {
  if (!c.onboarded) return onboardingPath(c.id);
  switch (dest) {
    case "calendar":
      return workspacePath(c.id, "", { calendar: 1 });
    case "analytics":
      return workspacePath(c.id, "", { tab: "overview" });
    case "visibility":
      return workspacePath(c.id, "", { geo: "findings" });
    case "competitors":
      return workspacePath(c.id, "competitors");
    case "backlinks":
      return workspacePath(c.id, "backlinks");
    case "accounts":
      return workspacePath(c.id, "", { settings: "accounts" });
    default:
      return workspacePath(c.id);
  }
}

/** Hand a prompt to exactly this workspace's chat (read once by ChatPanel). */
export function handPromptTo(workspaceId: string, prompt: string) {
  try {
    sessionStorage.setItem(`chat:prefill:${workspaceId}`, prompt);
  } catch {
    /* storage unavailable: the workspace still opens */
  }
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

const CHANNEL_BRAND: Record<string, BrandKey> = {
  instagram: "instagram",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  tiktok: "tiktok",
  youtube: "youtube",
  facebook: "facebook",
  threads: "threads",
  pinterest: "pinterest",
  reddit: "reddit",
};

export const CHANNEL_LABEL: Record<string, string> = {
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
  threads: "Threads",
  blog: "Blog",
  email: "Email",
  web: "Web",
  other: "Other",
};

export function channelLabel(ch: string | null | undefined): string {
  if (!ch) return "Post";
  return CHANNEL_LABEL[ch] ?? ch.charAt(0).toUpperCase() + ch.slice(1);
}

export function ChannelMark({ channel, size = 28 }: { channel: string | null; size?: number }) {
  const brand = channel ? CHANNEL_BRAND[channel] : undefined;
  const Icon = channel === "email" ? Mail : channel === "web" ? Globe : FileText;
  return (
    <span
      className="grid shrink-0 place-items-center rounded-full bg-[var(--ds-well-bg)] text-muted-foreground"
      style={{ height: size, width: size }}
      aria-hidden
    >
      {brand ? (
        <BrandLogo name={brand} brand size={Math.round(size * 0.5)} />
      ) : (
        <Icon className="h-[50%] w-[50%]" />
      )}
    </span>
  );
}

export function ClientMark({
  client,
  size = 32,
}: {
  client: Pick<CcClient, "name" | "domain" | "logoUrl">;
  size?: number;
}) {
  const [broken, setBroken] = useState(false);
  const [iconBroken, setIconBroken] = useState(false);
  if (client.logoUrl && !broken) {
    return (
      /* Workspace logo from its own storage/URL — not an app asset. */
      <img
        src={client.logoUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="shrink-0 rounded-[30%] bg-white object-contain ring-1 ring-border/60"
        style={{ height: size, width: size }}
      />
    );
  }
  if (client.domain && !iconBroken) {
    // Favicons are often black marks, so they sit on a white chip in both
    // themes (like an app icon) instead of vanishing on the dark canvas.
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-[30%] bg-white ring-1 ring-black/[0.06]"
        style={{ height: size, width: size }}
        aria-hidden
      >
        {/* A third-party favicon, not an app asset: no next/image optimisation. */}
        <img
          src={`https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(client.domain)}`}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setIconBroken(true)}
          className="h-full w-full object-contain p-[14%]"
        />
      </span>
    );
  }
  return (
    <span
      className="grid shrink-0 place-items-center rounded-[30%] bg-primary/15 font-semibold text-foreground ring-1 ring-primary/25"
      style={{ height: size, width: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {client.name.trim().charAt(0).toUpperCase() || "·"}
    </span>
  );
}

export function ClientTag({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex max-w-[160px] items-center truncate rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11px] font-medium text-foreground/80",
        className,
      )}
    >
      {name}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

export const TONE_TEXT: Record<HealthTone, string> = {
  good: "text-success",
  warn: "text-warning",
  risk: "text-destructive",
  idle: "text-muted-foreground",
};
const TONE_STROKE: Record<HealthTone, string> = {
  good: "hsl(var(--primary))",
  warn: "hsl(var(--warning))",
  risk: "hsl(var(--destructive))",
  idle: "hsl(var(--muted-foreground) / 0.5)",
};

export function HealthRing({
  score,
  tone,
  size = 44,
  children,
}: {
  score: number;
  tone: HealthTone;
  size?: number;
  children?: ReactNode;
}) {
  const reduce = useReducedMotion();
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ height: size, width: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          stroke="var(--ds-well-bg-hover)"
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke={TONE_STROKE[tone]}
          strokeDasharray={c}
          initial={{ strokeDashoffset: reduce ? c * (1 - score / 100) : c }}
          animate={{ strokeDashoffset: c * (1 - score / 100) }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center">{children}</span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce) {
      el.textContent = value.toLocaleString();
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.8,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        el.textContent = Math.round(v).toLocaleString();
      },
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {value.toLocaleString()}
    </span>
  );
}

export function StatTile({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
  onClick,
  active,
}: {
  label: string;
  value: number;
  sub?: string;
  icon: ReactNode;
  tone?: "neutral" | "primary" | "warn" | "risk";
  onClick?: () => void;
  active?: boolean;
}) {
  const Comp = onClick ? motion.button : motion.div;
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      whileHover={onClick ? { y: -2 } : undefined}
      whileTap={onClick ? { scale: 0.98 } : undefined}
      className={cn(
        "ds-tile group relative flex w-full flex-col gap-3 overflow-hidden p-4 text-left",
        onClick && "ds-tile-hover cursor-pointer",
        active && "border-primary/50",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "grid h-8 w-8 place-items-center rounded-full",
            tone === "primary" && "bg-primary/15 text-foreground",
            tone === "warn" && "bg-warning/12 text-warning",
            tone === "risk" && "bg-destructive/12 text-destructive",
            tone === "neutral" && "bg-[var(--ds-well-bg)] text-muted-foreground",
          )}
        >
          {icon}
        </span>
        {onClick && (
          <span className="text-[11px] font-medium text-muted-foreground opacity-0 transition group-hover:opacity-100">
            Open
          </span>
        )}
      </div>
      <div>
        <div className="text-[28px] font-semibold leading-none tracking-tight">
          <CountUp value={value} />
        </div>
        <div className="mt-1.5 text-[12.5px] font-medium text-foreground/80">{label}</div>
        {sub && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{sub}</div>}
      </div>
    </Comp>
  );
}

export function SectionTitle({
  title,
  count,
  action,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-center justify-between gap-3", className)}>
      <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
        {title}
        {typeof count === "number" && (
          <span className="rounded-full bg-[var(--ds-well-bg)] px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  );
}

export function timeAgo(iso: string, now: number): string {
  const mins = Math.max(1, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / 1440)}d ago`;
}

export function timeOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

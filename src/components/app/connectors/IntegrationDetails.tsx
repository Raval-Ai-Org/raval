"use client";

import type { ReactNode } from "react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { cn } from "@/lib/utils";
import { ConnectionLogo } from "./ConnectionCard";

export type IntegrationHealthItem = {
  label: string;
  detail: string;
  state: "healthy" | "warning" | "error";
};

const DOT = {
  healthy: "bg-success",
  warning: "bg-warning",
  error: "bg-destructive",
} as const;

/** Three or so checks, each a dot, a name and one word. */
export function ConnectionHealth({ items }: { items: IntegrationHealthItem[] }) {
  return (
    <ul className="grid gap-2 sm:grid-cols-3" aria-label="Connection checks">
      {items.map((item) => (
        <li key={item.label} className="ds-well flex min-w-0 items-center gap-2.5 px-3 py-2.5">
          <span className={cn("size-2 shrink-0 rounded-full", DOT[item.state])} aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[12.5px] font-medium text-foreground">
              {item.label}
            </span>
            <span className="block truncate text-[11.5px] text-muted-foreground">
              {item.detail}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A row in a details window: a small label on the left, the value on the right. */
export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="shrink-0 text-[12.5px] text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right text-[13px] font-medium text-foreground">
        {children}
      </span>
    </div>
  );
}

export function IntegrationDetails({
  open,
  onOpenChange,
  icon: Icon,
  logo,
  provider,
  title,
  account,
  status,
  children,
  health,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: React.ComponentType<{ className?: string }>;
  /** The brand mark shown beside the account. */
  logo: ReactNode;
  provider: string;
  title: string;
  /** Who is connected: an email, a user name or a site. */
  account: ReactNode;
  status: ReactNode;
  children: ReactNode;
  health: IntegrationHealthItem[];
  footer?: ReactNode;
}) {
  return (
    <AppModalShell
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      Icon={Icon}
      title={title}
      srDescription={`${provider} connection details`}
      bodyClassName="space-y-4 px-5 py-5 sm:px-6"
    >
      <div className="ds-tile ds-enter flex items-center gap-3 p-4">
        <ConnectionLogo>{logo}</ConnectionLogo>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold text-foreground">{account}</p>
          <p className="text-[12px] text-muted-foreground">{provider}</p>
        </div>
        {status}
      </div>
      <ConnectionHealth items={health} />
      {children}
      {footer && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-[var(--ds-tile-border)] pt-4">
          {footer}
        </div>
      )}
    </AppModalShell>
  );
}

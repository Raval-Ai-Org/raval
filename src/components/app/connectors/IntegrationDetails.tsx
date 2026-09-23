"use client";

import type { ReactNode } from "react";
import { CheckCircle, CircleAlert, ShieldCheck } from "lucide-react";
import { AppModalShell } from "@/components/app/AppModalShell";
import { cn } from "@/lib/utils";

export type IntegrationHealthItem = {
  label: string;
  detail: string;
  state: "healthy" | "warning" | "error";
};

export function ConnectionHealth({ items }: { items: IntegrationHealthItem[] }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-3">
      <div className="flex items-center gap-2 text-[12px] font-semibold">
        <ShieldCheck className="size-3.5 text-success" aria-hidden />
        Connection health
      </div>
      <ul className="mt-2 grid gap-2 sm:grid-cols-3">
        {items.map((item) => {
          const Icon = item.state === "healthy" ? CheckCircle : CircleAlert;
          return (
            <li key={item.label} className="flex min-w-0 items-start gap-2">
              <Icon
                className={cn(
                  "mt-0.5 size-3.5 shrink-0",
                  item.state === "healthy"
                    ? "text-success"
                    : item.state === "warning"
                      ? "text-warning"
                      : "text-destructive",
                )}
                aria-hidden
              />
              <span className="min-w-0">
                <span className="block text-[11.5px] font-medium">{item.label}</span>
                <span className="block truncate text-[10.5px] text-muted-foreground">
                  {item.detail}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function IntegrationDetails({
  open,
  onOpenChange,
  icon: Icon,
  provider,
  title,
  description,
  status,
  children,
  health,
  footer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  icon: React.ComponentType<{ className?: string }>;
  provider: string;
  title: string;
  description: string;
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
      description={description}
      srDescription={`${provider} connection details`}
      bodyClassName="space-y-4 px-5 py-5 sm:px-6"
    >
      <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 bg-card/60 px-3.5 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          Status
        </span>
        {status}
      </div>
      {children}
      <ConnectionHealth items={health} />
      {footer && <div className="flex flex-wrap justify-end gap-2">{footer}</div>}
    </AppModalShell>
  );
}

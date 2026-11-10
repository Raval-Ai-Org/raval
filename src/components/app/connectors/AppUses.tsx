"use client";

// "Use it now": what a connected app does in Mellox and a button to the place
// it happens (src/lib/integrations/uses.ts). Shown in the connector's opened
// view once the app is connected, and on Analytics' connect tiles. Every
// button only opens a place; nothing runs from here.
import {
  ArrowRight,
  BarChart3,
  Calendar,
  FileSpreadsheet,
  Folder,
  Mail,
  Megaphone,
  Palette,
  Send,
  Target,
  Users,
} from "@/components/icons";
import { emitAppEvent } from "@/lib/app-events";
import { appUses, type AppPlace, type AppUse, type AppUseIcon } from "@/lib/integrations/uses";
import { useOpenCreate } from "@/components/studio/use-open-create";
import { cn } from "@/lib/utils";

const ICONS: Record<AppUseIcon, React.ComponentType<{ className?: string }>> = {
  chart: BarChart3,
  megaphone: Megaphone,
  users: Users,
  mail: Mail,
  folder: Folder,
  sheet: FileSpreadsheet,
  palette: Palette,
  calendar: Calendar,
  target: Target,
  send: Send,
};

/** Go to a place. Studio goes through useOpenCreate so plan locks still apply. */
export function useOpenAppPlace() {
  const create = useOpenCreate();
  return (place: AppPlace) => {
    switch (place.kind) {
      case "analytics":
        emitAppEvent("open:analytics", { tab: place.tab });
        return;
      case "create":
        create.open(place.choice);
        return;
      case "calendar":
        emitAppEvent("open:content-calendar");
        return;
      case "library":
        emitAppEvent("open:library", { tab: "posts" });
        return;
      case "brain":
        emitAppEvent("open:brain", { section: place.section, tab: place.tab });
        return;
      case "campaigns":
        emitAppEvent("open:campaigns");
        return;
    }
  };
}

/** Presentational list of uses. `onGo` is called with a use's place. */
export function AppUsesList({
  uses,
  onGo,
  heading = "Use it now",
  className,
}: {
  uses: AppUse[];
  onGo?: (place: AppPlace) => void;
  heading?: string | null;
  className?: string;
}) {
  if (!uses.length) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {heading ? (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {heading}
        </p>
      ) : null}
      <ul className="grid gap-2 @lg:grid-cols-2">
        {uses.map((use) => {
          const Icon = ICONS[use.icon];
          return (
            <li
              key={use.title}
              className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/70 bg-[var(--ds-tile-bg,transparent)] p-3"
            >
              <div className="flex items-start gap-2.5">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-2 text-foreground">
                  <Icon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-snug text-foreground">
                    {use.title}
                  </p>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
                    {use.detail}
                  </p>
                </div>
              </div>
              {onGo ? (
                <button
                  type="button"
                  onClick={() => onGo(use.action.place)}
                  className="ml-10 inline-flex w-fit items-center gap-1 rounded-full px-2 py-1 text-[12px] font-medium text-foreground transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/55"
                >
                  {use.action.label}
                  <ArrowRight className="size-3.5" aria-hidden />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Wired: the uses of one app, with working buttons. */
export function AppUses({ app, className }: { app: string; className?: string }) {
  const go = useOpenAppPlace();
  return (
    <div className="@container">
      <AppUsesList uses={appUses(app)} onGo={go} className={className} />
    </div>
  );
}

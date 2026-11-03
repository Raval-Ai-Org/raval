"use client";

// The kinds of campaign, grouped, as cards. Used on Campaigns home and as the
// first step of the designer. Hovering a card brings up its phases.
import { PLAYBOOKS, PLAYBOOK_GROUPS } from "@/lib/campaigns/playbooks";
import { cn } from "@/lib/utils";
import { kindIcon } from "./kit";

export function Gallery({
  onPick,
  selected,
}: {
  onPick(type: string): void;
  selected?: string | null;
}) {
  return (
    <div className="space-y-6">
      {PLAYBOOK_GROUPS.map((g) => {
        const list = PLAYBOOKS.filter((p) => p.group === g.id);
        if (!list.length) return null;
        return (
          <div key={g.id}>
            <p className="ds-label mb-2">{g.label}</p>
            <div className="grid grid-cols-1 gap-2.5 @md/campaigns:grid-cols-2 @3xl/campaigns:grid-cols-3 @5xl/campaigns:grid-cols-4">
              {list.map((p) => {
                const Icon = kindIcon(p.icon);
                const on = selected === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    data-testid={`kind-${p.id}`}
                    aria-pressed={selected !== undefined ? on : undefined}
                    onClick={() => onPick(p.id)}
                    title={p.phases.map((ph) => ph.label).join(" → ")}
                    className={cn(
                      "ds-tile ds-tile-hover group relative flex items-center gap-3 overflow-hidden p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                      on && "ring-2 ring-primary/60",
                    )}
                  >
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-full transition-colors",
                        on
                          ? "bg-primary text-primary-foreground"
                          : "bg-primary/12 text-primary group-hover:bg-primary/18",
                      )}
                    >
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-semibold">{p.label}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {p.line}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

import { useState } from "react";
import { Search, PenLine, MessageCircle, type LucideIcon } from "@/components/ui/gemini-icons";
import { Switch } from "@/components/ui/switch";
import { useAgentToggles } from "@/hooks/use-agent-toggles";
import { agentList, type Agent } from "@/lib/agents";
import { AgentManageDialog } from "@/components/agents/AgentManageDialog";
import { cn } from "@/lib/utils";



const FEATURE: Record<string, { title: string; icon: LucideIcon }> = {
  seo:       { title: "Search visibility",  icon: Search },
  content:   { title: "Content creation",   icon: PenLine },
  social:    { title: "Social & community", icon: MessageCircle },
};

export function AgentManagementPanel() {
  const { activeCount, total, set, setAll, isOn } = useAgentToggles();
  const allOn = activeCount === total;
  const anyOn = activeCount > 0;
  const [openAgent, setOpenAgent] = useState<Agent | null>(null);


  return (
    <section className="ui-section-gap px-1">
      {/* Header — minimal, inline */}
      <header className="flex items-center justify-between border-b border-border/60 pb-2">
        <div className="flex items-center gap-2">
          <h2 className="ui-eyebrow">Automations</h2>
          <span className="text-[11px] text-muted-foreground/70">
            · {anyOn ? `${activeCount}/${total} active` : "all paused"}
          </span>
        </div>
        <button
          onClick={() => setAll(!allOn)}
          className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {allOn ? "Pause all" : "Run all"}
        </button>
      </header>

      {/* Line-by-line rows */}
      <ul className="divide-y divide-border/40">
        {agentList.map((a) => {
          const meta = FEATURE[a.slug] ?? { title: a.role, icon: Search };
          const Icon = meta.icon;
          const on = isOn(a.id);
          

          return (
            <li
              key={a.id}
              className="group flex items-center gap-3 py-2.5 text-[13px]"
            >
              <button
                type="button"
                onClick={() => setOpenAgent(a)}
                className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-0.5 text-left transition-colors hover:text-foreground"
                title={`Manage ${a.name}`}
              >
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-colors",
                    on ? "text-foreground/70" : "text-muted-foreground/50",
                  )}
                  strokeWidth={1.75}
                />
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate transition-colors",
                    on ? "text-foreground/90" : "text-muted-foreground/60",
                  )}
                >
                  {meta.title}
                </span>
                <span className="text-[10px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
                  {a.name}
                </span>
              </button>



              <Switch
                checked={on}
                onCheckedChange={(v) => set(a.id, v)}
                className="scale-75"
              />
            </li>
          );
        })}
      </ul>

      {openAgent && (
        <AgentManageDialog
          agent={openAgent}
          open={!!openAgent}
          onOpenChange={(v) => !v && setOpenAgent(null)}
        />
      )}
    </section>
  );
}

"use client";

// Settings → Agents (Phase 5 of ADR-0042): the six agents, each with what it
// does, where its work shows up and its real state (from getAgents, which only
// counts stored rows), then the Operations inbox: what the agents found, what
// waits for approval and what they did. `AgentsRoster` is presentational.
import { useEffect, useState } from "react";
import { useOptionalWorkspaceId } from "@/components/workspace/WorkspaceProvider";
import { ErrorState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { GroupLabel } from "@/components/app/surface/SurfaceLayout";
import { OperationsInbox } from "@/components/app/OperationsInbox";
import { getAgents } from "@/lib/agents.functions";
import { AUTOMATION_INFO, type Automation } from "@/lib/autopilot/contracts";
import { cn } from "@/lib/utils";

export type AgentRow = Awaited<ReturnType<typeof getAgents>>[number];

const STATE_LABEL: Record<AgentRow["state"], string> = {
  working: "Working",
  ready: "Ready",
  needs: "Needs setup",
  paused: "Paused",
};

const STATE_TONE: Record<AgentRow["state"], string> = {
  working: "bg-primary/15 text-foreground",
  ready: "bg-muted text-foreground",
  needs: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  paused: "bg-muted text-muted-foreground",
};

export function AgentsRoster({ agents }: { agents: AgentRow[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2" aria-label="Agents">
      {agents.map((agent) => (
        <li key={agent.id} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[15px] font-semibold">{agent.name}</p>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[12px] font-medium",
                STATE_TONE[agent.state],
              )}
            >
              {STATE_LABEL[agent.state]}
            </span>
          </div>
          <p className="mt-1 text-[13px] text-muted-foreground">{agent.does}</p>
          <p className="mt-2 text-[12px] text-muted-foreground">In {agent.place}</p>
          {agent.running.length > 0 && (
            <p className="mt-2 text-[12px]">
              Runs weekly:{" "}
              {agent.running.map((a) => AUTOMATION_INFO[a as Automation]?.label ?? a).join(", ")}
            </p>
          )}
          {agent.missing.length > 0 && (
            <ul className="mt-2 space-y-1">
              {agent.missing.map((m) => (
                <li key={m.need} className="text-[12px]">
                  <span className="font-medium">{m.missing}.</span>{" "}
                  <span className="text-muted-foreground">{m.fix}</span>
                </li>
              ))}
            </ul>
          )}
          {agent.checksOff.length > 0 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Some of its checks are switched off.
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function AgentsPanel() {
  const workspaceId = useOptionalWorkspaceId();
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!workspaceId) return;
    let live = true;
    setFailed(false);
    getAgents({ data: { workspaceId } })
      .then((rows) => live && setAgents(rows))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [workspaceId]);

  if (!workspaceId) return null;
  return (
    <div className="space-y-6">
      {failed ? (
        <ErrorState title="Couldn't load the agents" description="Try again in a moment." />
      ) : agents ? (
        <AgentsRoster agents={agents} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}
      <div>
        <GroupLabel>What they found and what waits for you</GroupLabel>
        <OperationsInbox />
      </div>
    </div>
  );
}

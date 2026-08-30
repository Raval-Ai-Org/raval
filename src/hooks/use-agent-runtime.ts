import { useEffect, useRef, useState } from "react";
import type { Agent, AgentMission } from "@/lib/agents";

export interface RunningMission {
  mission: AgentMission;
  startedAt: number;
  progress: number; // 0..100
}

export interface ActivityEvent {
  id: string;
  agentId: string;
  type: "deploy" | "tick" | "complete";
  message: string;
  timestamp: number;
}

export function useAgentRuntime(agent: Agent) {
  const [active, setActive] = useState(false);
  const [current, setCurrent] = useState<RunningMission | null>(null);
  const [queue, setQueue] = useState<AgentMission[]>([]);
  const [tasksToday, setTasksToday] = useState(0);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const tickRef = useRef<number | null>(null);

  const log = (e: Omit<ActivityEvent, "id" | "timestamp">) =>
    setEvents((prev) =>
      [{ ...e, id: crypto.randomUUID(), timestamp: Date.now() }, ...prev].slice(0, 60),
    );

  const deploy = (mission: AgentMission) => {
    if (!current) {
      setCurrent({ mission, startedAt: Date.now(), progress: 0 });
      log({ agentId: agent.id, type: "deploy", message: `Deployed: ${mission.label}` });
    } else {
      setQueue((q) => [...q, mission]);
      log({ agentId: agent.id, type: "deploy", message: `Queued: ${mission.label}` });
    }
    setActive(true);
  };

  // Auto-tick progress
  useEffect(() => {
    if (!active || !current) return;
    tickRef.current = window.setInterval(() => {
      setCurrent((c) => {
        if (!c) return c;
        const elapsed = (Date.now() - c.startedAt) / 1000;
        const pct = Math.min(100, (elapsed / c.mission.durationSec) * 100);
        if (pct >= 100) {
          log({ agentId: agent.id, type: "complete", message: `Completed: ${c.mission.label}` });
          setTasksToday((t) => t + 1);
          setLastRun(Date.now());
          // pull next
          setQueue((q) => {
            const [next, ...rest] = q;
            if (next) {
              setCurrent({ mission: next, startedAt: Date.now(), progress: 0 });
              log({ agentId: agent.id, type: "deploy", message: `Started: ${next.label}` });
            } else {
              setCurrent(null);
            }
            return rest;
          });
          return null;
        }
        return { ...c, progress: pct };
      });
    }, 250);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [active, current?.mission.id]);

  return { active, setActive, current, queue, tasksToday, lastRun, events, deploy };
}

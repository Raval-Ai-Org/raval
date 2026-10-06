"use client";

// Wires Autopilot into the chat message box: the switch in the toolbar, and
// the deck that covers the box while Autopilot is on.
//
// The full view is only loaded once the deck is showing, and Mellox's proposal
// is only asked for after a person flips the switch, so opening chat never
// starts work by itself.
import { useEffect, useState, type ReactNode } from "react";
import { openFeatureUpgrade } from "@/components/app/FeatureGate";
import { useEntitlements } from "@/lib/billing/use-entitlements";
import { useNavigate } from "@/lib/navigation";
import { workspacePath } from "@/lib/workspace/paths";
import type { Section } from "../AutopilotScreen";
import {
  useAutopilot,
  useAutopilotActions,
  useAutopilotOpen,
  useAutopilotStatus,
  useStrategySuggestion,
} from "../hooks";
import { AutopilotDeck, AutopilotToggle, type AutopilotSignal } from "./AutopilotDeck";

/** Where the full Autopilot screen is, optionally at one of its sections. */
export function autopilotPath(workspaceId: string, section?: Section): string {
  return workspacePath(workspaceId, "autopilot", {
    s: section && section !== "home" ? section : undefined,
  });
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function useComposerAutopilot({
  workspaceId,
  hero,
  onType,
}: {
  workspaceId: string;
  /** The box is the centred one of a new chat, where the deck shows by itself. */
  hero: boolean;
  /** Hand the box back to the keyboard, with the key that was pressed if any. */
  onType: (char?: string) => void;
}): {
  toolbarSlot: ReactNode;
  cover: ReactNode;
  /** Drives the box's look: lit while Autopilot runs. */
  signal: AutopilotSignal | "setup" | null;
} {
  const navigate = useNavigate();
  const status = useAutopilotStatus(workspaceId);
  const billing = useEntitlements();
  // "auto": the deck covers a new chat while Autopilot runs. A person's own
  // choice (show it / write instead) wins until they change it.
  const [wants, setWants] = useState<"auto" | "deck" | "type">("auto");

  const enabled = Boolean(status.data?.enabled);
  const program: "running" | "paused" | null =
    status.data?.status === "running" || status.data?.status === "paused"
      ? status.data.status
      : null;
  const running = program === "running";
  const covered = enabled && (wants === "deck" || (wants === "auto" && running && hero));

  const query = useAutopilot(workspaceId, covered);
  const view = query.data;
  const actions = useAutopilotActions(workspaceId);
  const suggestion = useStrategySuggestion(
    workspaceId,
    Boolean(covered && view && !view.program && view.canManage),
  );
  const openPlace = useAutopilotOpen(workspaceId);

  const grant = billing.data?.features.autopilot;
  const lockedPlan = grant && !grant.allowed ? grant.requiredPlan : null;

  const write = (char?: string) => {
    setWants("type");
    onType(char);
  };

  // While the deck covers the box, typing anywhere gives the box back.
  const typeThrough = covered && Boolean(view?.program);
  useEffect(() => {
    if (!typeThrough) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.isComposing || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setWants("type");
      onType(e.key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [typeThrough, onType]);

  if (!enabled) return { toolbarSlot: null, cover: null, signal: null };

  const toolbarSlot = (
    <AutopilotToggle
      state={running ? "on" : program === "paused" ? "paused" : "off"}
      waiting={status.data?.waiting ?? 0}
      lockedPlan={program ? null : lockedPlan}
      onClick={() => {
        if (!program && lockedPlan) return openFeatureUpgrade("autopilot");
        // Flipping it on while paused turns it back on, then shows it.
        if (program === "paused") actions.pause.mutate(false);
        setWants("deck");
      }}
    />
  );

  const cover = covered ? (
    <AutopilotDeck
      view={view}
      failed={Boolean(query.error)}
      suggestion={{
        data: suggestion.data,
        loading: suggestion.isLoading,
        failed: Boolean(suggestion.error),
      }}
      handlers={{
        start: (settings) => actions.start.mutate(settings),
        pause: (paused) => {
          // Stay on the deck, so pausing doesn't make it vanish.
          setWants("deck");
          actions.pause.mutate(paused);
        },
        write: () => write(),
        open: (section) => navigate({ to: autopilotPath(workspaceId, section) }),
        fix: openPlace,
        retry: () => void query.refetch(),
        busy: actions.start.isPending || actions.pause.isPending,
      }}
    />
  ) : null;

  const shown = view?.program?.status ?? program;
  const signal = covered
    ? shown === "running"
      ? "on"
      : shown === "paused"
        ? "paused"
        : "setup"
    : running
      ? "on"
      : null;

  return { toolbarSlot, cover, signal };
}

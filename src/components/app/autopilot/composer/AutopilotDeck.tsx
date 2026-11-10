"use client";

// The small marks Autopilot is recognised by: the orb, its switch, the pill
// in the message box's toolbar (opens Autopilot) and the top bar's beacon.
// Autopilot itself lives in Home's Autopilot area and its own screen; it
// never covers the message box.
import { motion } from "framer-motion";
import { Bot } from "@/components/icons";
import { PlanLock } from "@/components/app/billing/billing-ui";
import type { PlanId } from "@/lib/billing/catalog";

export type AutopilotSignal = "off" | "on" | "paused";

const EASE = [0.22, 1, 0.36, 1] as const;

/* ───────────────────────── small parts ───────────────────────── */

/** The mark that says "Autopilot": lime when it runs, amber when paused, grey when off. */
export function AutopilotOrb({
  state,
  size = 40,
}: {
  state: AutopilotSignal | "arming";
  size?: number;
}) {
  return (
    <span className="ap-orb" data-state={state} style={{ width: size, height: size }} aria-hidden>
      <span className="ap-orb__ring" />
      <span className="ap-orb__core">
        <Bot style={{ width: size * 0.34, height: size * 0.34 }} strokeWidth={2.2} />
      </span>
    </span>
  );
}

export function AutopilotSwitch({
  on,
  onChange,
  disabled,
  label,
}: {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className="ap-switch"
    >
      <span className="ap-switch__thumb" />
    </button>
  );
}

/** The pill in the message box's toolbar: says whether it runs, opens Autopilot. */
export function AutopilotToggle({
  state,
  waiting = 0,
  lockedPlan,
  onClick,
}: {
  state: AutopilotSignal;
  waiting?: number;
  lockedPlan?: PlanId | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={
        state === "on"
          ? "Autopilot is on. Open it."
          : state === "paused"
            ? "Autopilot is paused. Open it."
            : "Set up Autopilot"
      }
      title={
        state === "on" ? "Autopilot is on" : state === "paused" ? "Autopilot is paused" : undefined
      }
      onClick={onClick}
      className="ap-toggle"
      data-tour="autopilot"
      data-state={state}
    >
      <span className="ap-toggle__track" aria-hidden>
        <span className="ap-toggle__thumb" />
      </span>
      <span>Autopilot</span>
      {lockedPlan ? (
        <PlanLock plan={lockedPlan} className="ml-0.5" />
      ) : waiting > 0 ? (
        <span className="ap-badge" data-tone="warn">
          {waiting}
        </span>
      ) : null}
    </button>
  );
}

/** A small live sign for the top bar: Autopilot is running, wherever you are. */
export function AutopilotBeacon({
  state,
  waiting,
  onClick,
}: {
  state: "on" | "paused";
  waiting: number;
  onClick: () => void;
}) {
  const label =
    state === "paused"
      ? "Autopilot is paused"
      : waiting
        ? `Autopilot is on. ${waiting} to approve.`
        : "Autopilot is on";
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: EASE }}
      onClick={onClick}
      aria-label={label}
      title={label}
      className="ap-beacon"
      data-state={state}
    >
      <AutopilotOrb state={state} size={22} />
      <span className="hidden sm:inline">{state === "paused" ? "Paused" : "Autopilot"}</span>
      {waiting > 0 && (
        <span className="ap-badge" data-tone="warn">
          {waiting}
        </span>
      )}
    </motion.button>
  );
}

"use client";

// "N to approve" in the message box, for posts that wait for a person while
// Autopilot is off (a running campaign's pieces). With Autopilot on, its own
// switch already carries the count, so this stays away. Presentational.
import { Megaphone } from "@/components/icons";
import type { WorkspacePulse } from "@/lib/pulse/pulse";

export function WaitingChip({ pulse, onOpen }: { pulse: WorkspacePulse; onOpen: () => void }) {
  if (pulse.autopilot.status || !pulse.waiting) return null;
  const withWork = pulse.campaigns.filter((c) => c.waiting > 0);
  const name = withWork.length === 1 ? withWork[0].name : "Campaigns";
  const label = `${pulse.waiting} ${pulse.waiting === 1 ? "post waits" : "posts wait"} for your OK in ${withWork.length === 1 ? `"${name}"` : "your campaigns"}`;
  return (
    <button type="button" onClick={onOpen} className="ap-toggle" aria-label={label} title={label}>
      <Megaphone className="size-4 text-primary" />
      <span className="max-w-[9rem] truncate">{name}</span>
      <span className="ap-badge" data-tone="warn">
        {pulse.waiting}
      </span>
    </button>
  );
}

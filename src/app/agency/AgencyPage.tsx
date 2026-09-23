"use client";

// Command Center — one place to run every client workspace. The surface lives
// in src/components/app/command-center/; its pure model (queues, health,
// attention, schedule, report) in src/lib/agency/command-center.ts.
import { CommandCenter } from "@/components/app/command-center/CommandCenter";

export default function AgencyHQ() {
  return <CommandCenter />;
}

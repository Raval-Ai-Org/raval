// The Workers the platform runs. Adding one here is the only way a worker can
// be triggered (manual run, cron tick); each declares its own budget and uses
// only registry tools.
import "server-only";
import type { WorkerDefinition } from "../runtime";
import { contentFitWorker } from "./content-fit";
import { distributionReliabilityWorker } from "./distribution-reliability";

export const WORKERS: Record<string, WorkerDefinition> = {
  [distributionReliabilityWorker.name]: distributionReliabilityWorker,
  [contentFitWorker.name]: contentFitWorker,
};

export function getWorker(name: string): WorkerDefinition | undefined {
  return WORKERS[name];
}

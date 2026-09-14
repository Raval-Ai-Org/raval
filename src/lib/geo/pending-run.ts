"use client";

// pending-run.ts — remembers a "run an AI Visibility scan" request until the
// lazily loaded AI Visibility dialog is ready to act on it.
//
// Chat tools, chat actions and Studio suggestions emit `geo:run-audit`. The
// dialog that listens for it is code-split, so on a fresh load the event can
// fire before its chunk has mounted — and a plain window event is simply lost.
// The app shell calls ensureGeoRunCapture() eagerly; the dialog claims the
// request once when it mounts. (An explicit call, not a bare side-effect
// import: package.json declares "sideEffects": false, so the bundler would
// drop `import "./pending-run"`.)

import { onAppEvent } from "@/lib/app-events";

/** A request older than this is stale (the user has moved on). */
const MAX_AGE_MS = 30_000;

let pendingAt = 0;
let installed = false;

/** Start recording scan requests. Idempotent; a no-op on the server. */
export function ensureGeoRunCapture(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  onAppEvent("geo:run-audit", () => {
    pendingAt = Date.now();
  });
}

/** True once per fresh request; clears it so a remount never re-runs the scan. */
export function takePendingGeoRun(now = Date.now()): boolean {
  const fresh = pendingAt > 0 && now - pendingAt <= MAX_AGE_MS;
  pendingAt = 0;
  return fresh;
}

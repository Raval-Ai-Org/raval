// Creator (UGC) renders followed for the whole tab, not just while the
// Creator window is open. The window registers a render the moment it starts
// (or opens one still running); `UgcRenderWatcher`, mounted once in the shell,
// keeps reading it, shows it in the corner list (GeneratingPanel, via
// `work:update`) and says once when it is ready. Browser-only, no React.

export type TrackedRender = {
  renderId: string;
  workspaceId: string;
  projectId: string;
  title: string;
};

const tracked = new Map<string, TrackedRender>();
const listeners = new Set<(render: TrackedRender) => void>();

/** Follow this render until it settles. Repeated calls only update the title. */
export function trackUgcRender(render: TrackedRender) {
  const had = tracked.has(render.renderId);
  tracked.set(render.renderId, render);
  if (!had) listeners.forEach((l) => l(render));
}

export function untrackUgcRender(renderId: string) {
  tracked.delete(renderId);
}

export function trackedUgcRenders(): TrackedRender[] {
  return [...tracked.values()];
}

export function onUgcRenderTracked(listener: (render: TrackedRender) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What the corner list says while a render is on a step. */
export function ugcStepLabel(status: string): string {
  if (status === "processing") return "Filming";
  if (status === "persisting") return "Saving";
  return "Sending";
}

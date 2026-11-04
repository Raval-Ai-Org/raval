// Full windows in the canvas (Mellox 2.0, Holo): on a desktop a big window
// sits beside the sidebar instead of over it, so the sidebar must keep
// working while one is open. These windows are non-modal there; a press on
// the sidebar closes the window (and the row opens its place), any other
// press outside leaves it open. Browser-only helpers, no React.

import { useEffect } from "react";
import { emitAppEvent } from "@/lib/app-events";

/** The sidebar and its collapsed rail carry this attribute (AppShell). */
export const SIDEBAR_ATTR = "data-app-sidebar";

/** For Radix `onInteractOutside`: close only when the press is on the sidebar. */
export function closeOnlyFromSidebar(event: Event) {
  const target = event.target as Element | null;
  if (!target?.closest?.(`[${SIDEBAR_ATTR}]`)) event.preventDefault();
}

/** Whether a big window will sit in the canvas (desktop, inside the app). */
export function canEmbedWindow() {
  if (typeof window === "undefined" || window.innerWidth < 1024) return false;
  return Boolean(document.querySelector("[data-workspace-column]"));
}

/** Tell the sidebar which row this window belongs to while it is open. */
export function useShellWindow(id: string | undefined, open: boolean) {
  useEffect(() => {
    if (!id || !open) return;
    emitAppEvent("shell:window", { id, open: true });
    return () => emitAppEvent("shell:window", { id, open: false });
  }, [id, open]);
}

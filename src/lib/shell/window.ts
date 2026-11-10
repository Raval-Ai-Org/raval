// Screens on the canvas (Mellox 2.0, Holo): on a desktop a big screen is
// drawn inside the workspace column (the canvas host), never as a pop-up over
// the page, so the sidebar keeps working while one is open. A press on the
// sidebar closes the screen (and the row opens its place), any other press
// outside leaves it open. Browser-only helpers.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { addAppEventListener, emitAppEvent, removeAppEventListener } from "@/lib/app-events";

export const OPEN_MODAL_SELECTOR = [
  '[data-modal="true"][data-state="open"]',
  '[aria-modal="true"]:not([data-state="closed"])',
].join(", ");

export function clearStaleBodyPointerEvents(
  body: { style: { pointerEvents: string } },
  modalOpen: boolean,
) {
  if (body.style.pointerEvents !== "none" || modalOpen) return;
  body.style.pointerEvents = "";
}

/** The sidebar and its collapsed rail carry this attribute (AppShell). */
export const SIDEBAR_ATTR = "data-app-sidebar";

/**
 * Sidebar controls that only change the sidebar itself (collapse, expand,
 * "More"). Pressing one never closes a window: the canvas just resizes.
 */
export const SIDEBAR_KEEP_ATTR = "data-sidebar-keep";

/**
 * For Radix `onInteractOutside`: close only when the press is on the sidebar.
 * Focus moving to the sidebar never closes a window: a menu there (the
 * account menu) hands focus back to its button as it closes, which would
 * shut the very window it just opened (Settings). A real sidebar press is
 * also announced by `shell:leave`.
 */
export function closeOnlyFromSidebar(event: Event) {
  if (event.type === "dismissableLayer.focusOutside") {
    event.preventDefault();
    return;
  }
  const target = event.target as Element | null;
  if (!target?.closest?.(`[${SIDEBAR_ATTR}]`) || target.closest(`[${SIDEBAR_KEEP_ATTR}]`)) {
    event.preventDefault();
  }
}

/**
 * The element canvas screens are drawn into (AppShell). It lies over the
 * workspace column, so a screen inside it is part of the page: it is sized by
 * CSS, follows the sidebar as it opens or collapses, and can never sit over
 * the sidebar or lock the rest of the app.
 */
export const CANVAS_HOST_ATTR = "data-canvas-host";

/**
 * Where a big screen is drawn while `on`: the canvas host on a desktop inside
 * the app, `null` elsewhere (phones, labs, pages without the shell), and
 * `undefined` for the one render before that is known, during which the
 * caller draws nothing.
 */
export function useCanvasHost(on: boolean): HTMLElement | null | undefined {
  const [host, setHost] = useState<HTMLElement | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (!on) {
      setHost(undefined);
      return;
    }
    const desktop = window.matchMedia("(min-width: 1024px)");
    const find = () =>
      setHost(
        desktop.matches ? document.querySelector<HTMLElement>(`[${CANVAS_HOST_ATTR}]`) : null,
      );
    find();
    desktop.addEventListener("change", find);
    return () => desktop.removeEventListener("change", find);
  }, [on]);
  return on ? host : undefined;
}

/** Whether a screen is open on the canvas right now (anything in the host). */
export function useCanvasBusy(): boolean {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(`[${CANVAS_HOST_ATTR}]`);
    if (!host) return;
    const check = () => setBusy(host.childElementCount > 0);
    check();
    const observer = new MutationObserver(check);
    observer.observe(host, { childList: true });
    return () => observer.disconnect();
  }, []);
  return busy;
}

/**
 * Tell the sidebar which row this window belongs to while it is open, and
 * step aside (`close`) when a sidebar row is pressed. The press itself may not
 * reach the window (keyboard, a window that opened modal), so the sidebar says
 * so out loud rather than relying on Radix's "pressed outside".
 */
export function useShellWindow(id: string | undefined, open: boolean, close?: () => void) {
  useEffect(() => {
    if (!id || !open) return;
    emitAppEvent("shell:window", { id, open: true });
    return () => emitAppEvent("shell:window", { id, open: false });
  }, [id, open]);
  const closeRef = useRef(close);
  closeRef.current = close;
  const canClose = Boolean(close);
  useEffect(() => {
    if (!open || !canClose) return;
    const on = () => closeRef.current?.();
    addAppEventListener("shell:leave", on);
    return () => removeAppEventListener("shell:leave", on);
  }, [open, canClose]);
}

/**
 * Radix sets `pointer-events: none` on <body> while a modal is open and can
 * leave it behind when one window closes as another menu or dialog opens
 * (Settings from the account menu, say). The whole app then ignores clicks:
 * the "stuck screen". Mounted once in the shell, this clears it whenever
 * nothing modal is actually open.
 */
export function useBodyPointerGuard() {
  useEffect(() => {
    const body = document.body;
    let timer = 0;

    const check = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        clearStaleBodyPointerEvents(body, Boolean(document.querySelector(OPEN_MODAL_SELECTOR)));
      }, 120);
    };
    const observer = new MutationObserver(check);
    // Body locking and portal mounts/unmounts.
    observer.observe(body, { attributes: true, attributeFilter: ["style"], childList: true });
    const stateObserver = new MutationObserver(check);
    // Radix updates open/closed state on the portal descendants.
    stateObserver.observe(body, {
      attributes: true,
      attributeFilter: ["data-state"],
      subtree: true,
    });
    check();
    return () => {
      observer.disconnect();
      stateObserver.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
}

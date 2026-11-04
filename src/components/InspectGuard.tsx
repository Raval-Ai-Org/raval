"use client";

import { useEffect } from "react";

// Deterrent only: it removes the obvious ways to open the browser's inspector
// (right-click menu, F12 and the Ctrl/Cmd+Shift+I/J/C and Ctrl/Cmd+U
// shortcuts). Anyone can still open DevTools from the browser menu, so no
// secret or authorization decision may ever rely on this; those stay on the
// server. Production only, so development is unaffected, and form fields keep
// their normal context menu (paste, spell-check).
const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function InspectGuard() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;

    const onContextMenu = (e: MouseEvent) => {
      if (!isEditable(e.target)) e.preventDefault();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      const blocked =
        e.key === "F12" ||
        (mod && e.shiftKey && ["i", "j", "c", "k"].includes(key)) ||
        (e.metaKey && e.altKey && ["i", "j", "c", "u"].includes(key)) ||
        (mod && key === "u");
      if (blocked) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  return null;
}

"use client";

// The React-hook half of app-events.ts, split into its own client-only module
// so importing an event name or emitAppEvent from server code never pulls in
// `react`'s useEffect/useRef (which Next.js refuses to bundle into a Server
// Component / route module).
import { useEffect, useRef } from "react";
import {
  onAppEvent,
  type AppEventHandler,
  type AppEventName,
} from "@/lib/app-events";

/**
 * Subscribe for the component's lifetime. The latest handler is always
 * called, so it can close over fresh state without re-subscribing.
 */
export function useAppEvent<K extends AppEventName>(name: K, handler: AppEventHandler<K>): void {
  const ref = useRef(handler);
  useEffect(() => {
    ref.current = handler;
  });
  useEffect(() => onAppEvent(name, (event) => ref.current(event)), [name]);
}

"use client";

import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to realtime changes on `content_items` (and optionally `approvals`)
 * for the given workspace. Fires `content:changed` / `approvals:changed`
 * window events so existing consumers refresh — no API surface change.
 *
 * Mount this once near the app root for the active workspace.
 */
export function useRealtimeContent(workspaceId: string | null) {
  useEffect(() => {
    if (!workspaceId) return;

    const channel = supabase
      .channel(`ws-realtime:${workspaceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "content_items",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          try {
            window.dispatchEvent(new CustomEvent("content:changed", { detail: payload }));
          } catch {
            /* noop */
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "approvals",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          try {
            window.dispatchEvent(new CustomEvent("approvals:changed", { detail: payload }));
          } catch {
            /* noop */
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);
}

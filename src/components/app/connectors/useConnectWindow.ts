"use client";

// useConnectWindow — connect a service in a small sign-in window and hear back
// when it ends. `onDone` gets the result the window announced, or null when the
// person simply came back to this tab (window closed by hand, or the browser
// has no BroadcastChannel). Either way the caller re-reads the connection.
import { useCallback, useEffect, useRef, useState } from "react";
import {
  onConnectResult,
  openConnectWindow,
  type ConnectProvider,
  type ConnectResult,
  type ConnectWindow,
} from "@/lib/connectors/connect-window";

export function useConnectWindow(
  provider: ConnectProvider,
  workspaceId: string | null | undefined,
  onDone: (result: ConnectResult | null) => void,
) {
  const [waiting, setWaiting] = useState(false);
  const waitingRef = useRef(false);
  const heardAt = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;

  const setWait = (value: boolean) => {
    waitingRef.current = value;
    setWaiting(value);
  };

  useEffect(() => {
    const off = onConnectResult((result) => {
      if (result.provider !== provider) return;
      if (result.workspaceId && workspaceId && result.workspaceId !== workspaceId) return;
      heardAt.current = Date.now();
      setWait(false);
      done.current(result);
    });
    const onFocus = () => {
      if (!waitingRef.current) return;
      // The announcement lands just before the window closes; give it a moment.
      window.setTimeout(() => {
        if (!waitingRef.current || Date.now() - heardAt.current < 3000) return;
        setWait(false);
        done.current(null);
      }, 400);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      off();
      window.removeEventListener("focus", onFocus);
    };
  }, [provider, workspaceId]);

  /**
   * Call inside the click. `getUrl` asks the server for the sign-in address;
   * pass a window already reserved with `openConnectWindow` when the click
   * handler has to do other work first.
   */
  const connect = useCallback(
    async (getUrl: () => Promise<string>, reserved?: ConnectWindow) => {
      const win = reserved ?? openConnectWindow(provider);
      setWait(win.separate);
      try {
        win.go(await getUrl());
      } catch (e) {
        win.close();
        setWait(false);
        throw e;
      }
    },
    [provider],
  );

  return { waiting, connect };
}

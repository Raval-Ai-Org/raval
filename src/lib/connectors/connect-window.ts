// connect-window.ts — every "Connect <service>" button opens the service's
// sign-in in a small window, so the page the person was working on stays as it
// is. The window comes back to a Mellox page on this origin, which tells every
// open Mellox tab the result over a BroadcastChannel and closes itself.
//
// The result only says "look again": whoever hears it re-reads the connection
// from the server. Nothing here is trusted as proof that anything is connected.
//
// If the browser blocks the window, the sign-in opens in this tab instead (the
// old behaviour), and the callback pages return to where the person started.

const CHANNEL = "mellox:connect";
const MARK = "mellox:connect-window";
const NAME = "mellox-connect";

export type ConnectProvider =
  "github" | "wordpress" | "webflow" | "slack" | "notion" | "canva" | "google";

export const CONNECT_PROVIDER_LABEL: Record<ConnectProvider, string> = {
  github: "GitHub",
  wordpress: "WordPress",
  webflow: "Webflow",
  slack: "Slack",
  notion: "Notion",
  canva: "Canva",
  google: "Google",
};

export type ConnectResult = {
  provider: ConnectProvider;
  status: "connected" | "cancelled" | "error";
  workspaceId?: string | null;
  /** Account names to show in the confirmation, when the provider has them. */
  accounts?: string[];
};

export type ConnectWindow = {
  /** False when the browser blocked the window and this tab is used instead. */
  separate: boolean;
  go: (url: string) => void;
  close: () => void;
};

const isProvider = (value: unknown): value is ConnectProvider =>
  typeof value === "string" && value in CONNECT_PROVIDER_LABEL;

/**
 * Reserve the sign-in window. Call it inside the click, before any `await`:
 * browsers block a window opened after network work.
 */
export function openConnectWindow(provider: ConnectProvider): ConnectWindow {
  const width = 620;
  const height = 760;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - width) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - height) / 2));
  let popup: Window | null = null;
  try {
    popup = window.open(
      "about:blank",
      `${NAME}-${provider}`,
      `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
    );
  } catch {
    popup = null;
  }
  if (!popup) {
    return { separate: false, go: (url) => window.location.assign(url), close: () => undefined };
  }
  try {
    // Survives the trip to the provider and back: storage is per tab and origin.
    popup.sessionStorage.setItem(MARK, provider);
    const doc = popup.document;
    doc.title = `Connect ${CONNECT_PROVIDER_LABEL[provider]}`;
    const dark = document.documentElement.classList.contains("dark");
    doc.body.style.cssText = `margin:0;display:grid;place-items:center;height:100vh;font:500 14px system-ui,sans-serif;background:${dark ? "#000" : "#f3f4f7"};color:${dark ? "#a1a1aa" : "#52525b"}`;
    doc.body.textContent = `Opening ${CONNECT_PROVIDER_LABEL[provider]}…`;
  } catch {
    /* The window still works; the callback falls back to its name. */
  }
  const win = popup;
  return {
    separate: true,
    go: (url) => {
      win.location.href = url;
      win.focus();
    },
    close: () => win.close(),
  };
}

/** The provider this window was opened to connect, if it is a sign-in window. */
export function connectWindowProvider(): ConnectProvider | null {
  if (typeof window === "undefined") return null;
  try {
    const marked = sessionStorage.getItem(MARK);
    if (isProvider(marked)) return marked;
  } catch {
    /* storage unavailable */
  }
  const named = window.name.startsWith(`${NAME}-`) ? window.name.slice(NAME.length + 1) : null;
  return isProvider(named) ? named : null;
}

export function isConnectWindow(): boolean {
  return connectWindowProvider() !== null;
}

/** Tell every open Mellox tab that a connection attempt ended. */
export function announceConnectResult(result: ConnectResult): void {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage(result);
    channel.close();
  } catch {
    /* The page that started it re-reads when the person comes back to it. */
  }
}

/**
 * Called by the page a provider returns to. Announces the result and, in a
 * sign-in window, closes it. Returns false when this is an ordinary tab, so the
 * caller carries on with its own redirect.
 */
export function finishConnectWindow(result: ConnectResult): boolean {
  announceConnectResult(result);
  if (!isConnectWindow()) return false;
  try {
    sessionStorage.removeItem(MARK);
  } catch {
    /* ignore */
  }
  window.close();
  return true;
}

export function onConnectResult(handler: (result: ConnectResult) => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => undefined;
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent) => {
    const data = event.data as Partial<ConnectResult> | null;
    if (!data || !isProvider(data.provider)) return;
    if (data.status !== "connected" && data.status !== "cancelled" && data.status !== "error")
      return;
    handler({
      provider: data.provider,
      status: data.status,
      workspaceId: typeof data.workspaceId === "string" ? data.workspaceId : null,
      accounts: Array.isArray(data.accounts) ? data.accounts.map(String).slice(0, 10) : undefined,
    });
  };
  return () => channel.close();
}

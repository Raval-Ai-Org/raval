import { isGoogleWebClientId } from "@/lib/google-auth-config";

export async function loadGoogleClientId(): Promise<string> {
  const response = await fetch("/api/auth/google/config", {
    cache: "no-store",
    credentials: "same-origin",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Google sign-in configuration unavailable");
  const data: unknown = await response.json();
  const clientId = data && typeof data === "object" && "clientId" in data ? data.clientId : null;
  if (!isGoogleWebClientId(clientId)) throw new Error("Google sign-in configuration unavailable");
  return clientId;
}

export type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    nonce: string;
    callback: (response: { credential?: string }) => void;
    ux_mode: "popup";
    auto_select: false;
  }): void;
  renderButton(
    element: HTMLElement,
    options: {
      type: "standard";
      theme: "outline" | "filled_black";
      size: "large";
      text: "continue_with";
      shape: "pill";
      logo_alignment: "center";
      width: number;
    },
  ): void;
};

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdentity } };
  }
}

export async function createGoogleNonce() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(nonce));
  const hashedNonce = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { nonce, hashedNonce };
}

let scriptPromise: Promise<GoogleIdentity> | undefined;

/** Load only on auth pages; failed/blocked loads can be retried. */
export function loadGoogleIdentity(): Promise<GoogleIdentity> {
  if (window.google?.accounts.id) return Promise.resolve(window.google.accounts.id);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.referrerPolicy = "strict-origin-when-cross-origin";
    const fail = () => {
      clearTimeout(timer);
      script.onload = script.onerror = null;
      script.remove();
      scriptPromise = undefined;
      reject(new Error("Google sign-in could not load. Check your connection and try again."));
    };
    const timer = setTimeout(fail, 15_000);
    script.onerror = fail;
    script.onload = () => {
      if (!window.google?.accounts.id) return fail();
      clearTimeout(timer);
      script.onload = script.onerror = null;
      resolve(window.google.accounts.id);
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

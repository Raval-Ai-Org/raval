"use client";

import { useEffect, useRef, useState } from "react";
import { createGoogleNonce, loadGoogleIdentity, loadGoogleClientId } from "@/lib/google-identity";
import { signInWithGoogle, friendlyAuthError } from "@/lib/auth";
import styles from "./GoogleSignInButton.module.css";

export function GoogleSignInButton({
  disabled,
  onSuccess,
  onBusyChange,
  onError,
}: {
  disabled: boolean;
  onSuccess: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  onError: (error: unknown) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handlers = useRef({ disabled, onSuccess, onBusyChange, onError });
  handlers.current = { disabled, onSuccess, onBusyChange, onError };
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "busy" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    let consumed = false;
    const element = host.current!;
    setStatus("loading");
    element.replaceChildren();
    async function setup() {
      try {
        // Load the SDK only after runtime configuration is valid.
        const clientId = await loadGoogleClientId();
        if (!active) return;
        const [google, { nonce, hashedNonce }] = await Promise.all([
          loadGoogleIdentity(),
          createGoogleNonce(),
        ]);
        if (!active) return;
        const createdAt = Date.now();
        google.initialize({
          client_id: clientId,
          nonce: hashedNonce,
          ux_mode: "popup",
          auto_select: false,
          callback: async ({ credential }) => {
            if (!active || consumed || handlers.current.disabled) return;
            consumed = true;
            setStatus("busy");
            handlers.current.onBusyChange(true);
            try {
              if (Date.now() - createdAt > 10 * 60 * 1000) {
                throw new Error("Google sign-in attempt expired");
              }
              await signInWithGoogle(credential ?? "", nonce);
              if (active) await handlers.current.onSuccess();
            } catch (error) {
              if (active) {
                handlers.current.onError(error);
                setAttempt((value) => value + 1);
              }
            } finally {
              if (active) handlers.current.onBusyChange(false);
            }
          },
        });
        google.renderButton(element, {
          type: "standard",
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "rectangular",
          logo_alignment: "center",
          width: Math.min(400, Math.floor(element.getBoundingClientRect().width)),
        });
        setStatus("ready");
      } catch (error) {
        if (active) {
          setLoadError(friendlyAuthError(error));
          setStatus("error");
        }
      }
    }
    void setup();
    return () => {
      active = false;
      element.replaceChildren();
    };
  }, [attempt]);

  return (
    <div className="min-h-10 w-full">
      <div ref={host} inert={disabled || status !== "ready"} className={styles.host} />
      {status !== "ready" && (
        <div role="status" className="text-center text-sm text-muted-foreground">
          {status === "error"
            ? loadError
            : status === "busy"
              ? "Finishing Google sign-in…"
              : "Loading Google sign-in…"}
          {status === "error" && (
            <button
              type="button"
              className="ml-2 underline"
              disabled={disabled}
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}

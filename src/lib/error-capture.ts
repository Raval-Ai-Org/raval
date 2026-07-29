// Captures the last uncaught error surfaced during SSR so we can log it
// even when h3 swallows the throw into a generic JSON 500 response.

let lastCapturedError: unknown | null = null;

function record(error: unknown) {
  lastCapturedError = error;
}

if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as {
    addEventListener?: (event: string, handler: (e: unknown) => void) => void;
  };
  g.addEventListener?.("error", (event) => {
    const err = (event as { error?: unknown }).error;
    if (err) record(err);
  });
  g.addEventListener?.("unhandledrejection", (event) => {
    const reason = (event as { reason?: unknown }).reason;
    if (reason) record(reason);
  });
}

export function consumeLastCapturedError(): unknown | null {
  const err = lastCapturedError;
  lastCapturedError = null;
  return err;
}

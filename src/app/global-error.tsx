"use client";

import { useEffect } from "react";

// Catches failures thrown from the root layout itself. Mirrors the branded
// 500 page the previous server entry rendered for unrecoverable SSR errors.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0f1411",
          color: "#f7f8fa",
          fontFamily: '"Google Sans Flex", "Segoe UI", sans-serif',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: "center", padding: "0 16px" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>
            An unexpected error occurred. Please try again.
          </p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "8px 16px",
              borderRadius: 6,
              border: 0,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

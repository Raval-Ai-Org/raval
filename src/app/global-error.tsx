"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

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
    reportClientError(error);
  }, [error]);

  return (
    <html lang="en" className="light">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #F2F23A 0%, #2BEA4E 38%, #19D6E6 70%, #1E7BF5 100%)",
          color: "#2F3335",
          fontFamily: '"Google Sans Flex", "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            maxWidth: 420,
            margin: "0 16px",
            padding: "32px 28px",
            textAlign: "center",
            background: "#fff",
            borderRadius: 26,
            boxShadow: "0 30px 80px -30px rgb(22 25 27 / 0.45)",
          }}
        >
          <img
            src="/brand/mox/face.webp"
            alt=""
            width={96}
            height={96}
            style={{ display: "block", margin: "0 auto 8px" }}
          />
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Something went wrong</h1>
          <p style={{ marginTop: 8, fontSize: 14, opacity: 0.7 }}>Please try again.</p>
          <button
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "10px 20px",
              borderRadius: 999,
              border: 0,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 700,
              color: "#2F3335",
              background: "linear-gradient(90deg, #D9F53A, #2EE66B, #19D6E6)",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}

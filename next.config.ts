import type { NextConfig } from "next";

// ── Security headers (proposal workstream E) ────────────────────────────────
// Content-Security-Policy is set here (not per-request in proxy.ts): a nonce
// CSP would force every page — landing and SEO pages included — into dynamic
// rendering (see node_modules/next/dist/docs/01-app/02-guides/
// content-security-policy.md). Scripts therefore keep 'unsafe-inline' for
// Next's inline bootstrap and the JSON-LD blocks, while the directives that
// matter most for a client-side token store are strict:
//   connect-src  only our origin, Supabase, and the pdf.js worker CDN —
//                an injected script cannot exfiltrate the session elsewhere;
//   frame-ancestors 'none' / X-Frame-Options DENY — no clickjacking;
//   object-src 'none', base-uri 'self', form-action 'self'.
// Session tokens live in localStorage (Supabase browser client); this policy
// is the main mitigation until the admin surface gets its own origin.
const isDev = process.env.NODE_ENV !== "production";

function supabaseOrigins(): string[] {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  try {
    const u = new URL(raw);
    return [`https://${u.host}`, `wss://${u.host}`];
  } catch {
    return ["https://*.supabase.co", "wss://*.supabase.co"];
  }
}

const PDF_WORKER_CDN = "https://cdn.jsdelivr.net";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${PDF_WORKER_CDN}${isDev ? " 'unsafe-eval'" : ""}`,
  `worker-src 'self' blob: ${PDF_WORKER_CDN}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  // Generated images/videos come from provider CDNs; stock media from
  // Pexels/Unsplash/Coverr; avatars from Google.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  `connect-src 'self' ${supabaseOrigins().join(" ")} ${PDF_WORKER_CDN}${isDev ? " ws: http://localhost:*" : ""}`,
  "frame-src 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Popups are allowed to keep a handle (Google sign-in); everything else isolated.
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  ...(isDev
    ? []
    : [
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ]),
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // A second dev server (e.g. a verification run next to your own) can build
  // into its own directory instead of fighting over .next.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  poweredByHeader: false,
  serverExternalPackages: ["pdfjs-dist", "mammoth", "xlsx"],
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // API responses carry user data: never cache in shared caches.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;

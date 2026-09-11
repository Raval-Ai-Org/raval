import type { MetadataRoute } from "next";

// robots.txt generated from the deployment's own origin (APP_URL /
// NEXT_PUBLIC_APP_URL). The static public/robots.txt hardcoded an old domain,
// so every other deployment advertised someone else's sitemap.
const ORIGIN = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://raval.ai").replace(
  /\/+$/,
  "",
);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/app",
        "/app/",
        "/workspace",
        "/workspaces",
        "/login",
        "/signup",
        "/onboarding",
        "/projects",
        "/agency",
        "/auth/",
        "/reset-password",
        "/share/",
        "/api/",
      ],
    },
    sitemap: `${ORIGIN}/sitemap.xml`,
  };
}

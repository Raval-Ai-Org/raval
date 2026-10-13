import type { MetadataRoute } from "next";

import { SITE_URL } from "@/marketing/lib/seo";

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
        "/admin",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}

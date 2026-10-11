import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/integrations/supabase/types";
import { authNextPath, safeNextPath, START_PATH } from "@/lib/redirects";

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) throw new Error("Supabase public auth configuration is missing.");
  return { url, key };
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { url, key } = getSupabaseConfig();
  const supabase = createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Verified locally against the project's signing keys (cached), like
  // verifyBearer in src/server/api-auth.ts. getUser() here was a network call
  // to Supabase on every navigation and prefetch. This only decides redirects;
  // routes and server functions still check access themselves.
  let user = false;
  try {
    const { data } = await supabase.auth.getClaims();
    user = Boolean(data?.claims?.sub);
  } catch {
    // An undecodable cookie is the same as no session.
  }
  const pathname = request.nextUrl.pathname;
  const isRoot = pathname === "/";
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isProtectedPage =
    pathname === "/projects" ||
    pathname === START_PATH ||
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/agency" ||
    pathname.startsWith("/agency/") ||
    pathname === "/onboarding" ||
    pathname.startsWith("/onboarding/") ||
    pathname === "/content" ||
    pathname.startsWith("/content/") ||
    pathname === "/social" ||
    pathname.startsWith("/social/") ||
    pathname === "/analytics" ||
    pathname.startsWith("/analytics/") ||
    pathname === "/seo" ||
    pathname.startsWith("/seo/") ||
    pathname.startsWith("/w/");

  if (user && (isRoot || isAuthPage)) {
    // Already signed in: go where the login was headed (an invite link, a
    // workspace page), not always /projects.
    // A website typed on the landing page (?url=) goes straight to its scan.
    const next = isAuthPage ? authNextPath(request.nextUrl.searchParams) : "/projects";
    return NextResponse.redirect(new URL(next, request.url));
  }

  if (!user && isProtectedPage) {
    const next = safeNextPath(`${pathname}${request.nextUrl.search}`, "/projects");
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/",
    "/login",
    "/signup",
    "/projects/:path*",
    "/start",
    "/app/:path*",
    "/agency/:path*",
    "/onboarding/:path*",
    "/content/:path*",
    "/social/:path*",
    "/analytics/:path*",
    "/seo/:path*",
    "/w/:path*",
  ],
};

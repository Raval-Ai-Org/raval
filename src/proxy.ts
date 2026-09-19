import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/integrations/supabase/types";
import { safeNextPath } from "@/lib/redirects";

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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const pathname = request.nextUrl.pathname;
  const isRoot = pathname === "/";
  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isProtectedPage =
    pathname === "/projects" ||
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
    return NextResponse.redirect(new URL("/projects", request.url));
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

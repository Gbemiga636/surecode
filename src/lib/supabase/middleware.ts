import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    console.error("[middleware] Missing NEXT_PUBLIC_SUPABASE_URL or ANON_KEY");
    return supabaseResponse;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  let user = null as { id: string } | null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    console.warn("[middleware] auth.getUser failed", e);
  }

  const path = request.nextUrl.pathname;
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/signup") ||
    path.startsWith("/auth") ||
    path.startsWith("/api/crawl") ||
    path.startsWith("/how");

  if (!user && !isPublic) {
    const protectedRoots = [
      "/home",
      "/past",
      "/demo",
      "/codes",
      "/predictions",
      "/expert",
      "/value",
      "/analysis",
      "/combos",
      "/saved",
      "/leaderboard",
    ];
    if (protectedRoots.some((p) => path === p || path.startsWith(p + "/"))) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

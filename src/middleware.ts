import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // GPT Actions authenticate with a Bearer token — skip the Supabase session round-trip.
  if (request.nextUrl.pathname.startsWith("/api/gpt")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/prediction-log")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/cron/")) return NextResponse.next();
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};

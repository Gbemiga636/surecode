import { NextResponse } from "next/server";
import { reachability } from "@/lib/exbot/reach";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const preferredRegion = "bom1";

/** Public: server region and whether each exchange API answers from it. No account data. */
export async function GET() {
  return NextResponse.json(await reachability(), { headers: { "cache-control": "no-store" } });
}

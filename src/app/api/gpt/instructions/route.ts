import { NextResponse } from "next/server";
import {
  GPT_CONVERSATION_STARTERS,
  GPT_DESCRIPTION,
  GPT_INSTRUCTIONS,
  GPT_NAME,
} from "@/lib/gpt-instructions";
import { siteBaseUrl } from "@/lib/gpt-auth";

export const dynamic = "force-dynamic";

/** Copy-paste kit for the Custom GPT builder. ?format=text returns only the Instructions. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("format") === "text") {
    return new NextResponse(GPT_INSTRUCTIONS, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return NextResponse.json({
    name: GPT_NAME,
    description: GPT_DESCRIPTION,
    instructions: GPT_INSTRUCTIONS,
    instructionsLength: GPT_INSTRUCTIONS.length,
    conversationStarters: GPT_CONVERSATION_STARTERS,
    capabilities: { webSearch: true, codeInterpreter: true, imageGeneration: false },
    actionsSchemaUrl: `${siteBaseUrl()}/api/gpt/openapi`,
  });
}

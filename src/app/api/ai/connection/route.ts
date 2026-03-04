import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { connectionCheckPrompt } from "@/lib/prompts";

export interface ConnectionResult {
  hasConnection: boolean;
  currentTopic?: string;
  earlierTopic?: string;
  relationship?: string;
  insight?: string;
}

/**
 * Proactive connection surfacing. Every 75 words.
 * gpt-4o-mini, returns JSON.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { hasConnection: false } as ConnectionResult,
        { status: 200 }
      );
    }

    const body = await request.json();
    const { fullDocument = "" } = body;

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: connectionCheckPrompt(fullDocument) },
          { role: "user", content: "Check for connections." },
        ],
        max_tokens: 150,
        temperature: 0.2,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
    let result: ConnectionResult = { hasConnection: false };

    try {
      const parsed = JSON.parse(raw);
      if (parsed.hasConnection === true) {
        result = {
          hasConnection: true,
          currentTopic: parsed.currentTopic,
          earlierTopic: parsed.earlierTopic,
          relationship: parsed.relationship,
          insight: parsed.insight,
        };
      }
    } catch {
      // ignore
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json(
        { hasConnection: false } as ConnectionResult,
        { status: 200 }
      );
    }
    return NextResponse.json(
      { hasConnection: false } as ConnectionResult,
      { status: 200 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import {
  ghostTextSystemPrompt,
  listContinuationSystemPrompt,
} from "@/lib/prompts";

/**
 * Ghost text completion endpoint.
 * Model: gpt-4o-mini, non-streaming, max 60 tokens.
 * Supports mode: "list" for list continuation (pass listContext).
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ result: "" }, { status: 200 });
    }

    const body = await request.json();
    const {
      contentBeforeCursor,
      noteType = "GENERAL",
      mode = "default",
      listContext,
    } = body;

    const isListMode = mode === "list" && typeof listContext === "string";

    if (!isListMode && typeof contentBeforeCursor !== "string") {
      return NextResponse.json(
        { error: "contentBeforeCursor is required for default mode" },
        { status: 400 }
      );
    }

    const systemPrompt = isListMode
      ? listContinuationSystemPrompt(noteType)
      : ghostTextSystemPrompt(noteType);

    const userContent = isListMode
      ? `Continue this list with the single most likely next item. Return ONLY the text of the next item, no bullet character, no numbering:\n\n${listContext}`
      : `Complete this note text (return only the completion, nothing else):\n\n${(contentBeforeCursor ?? "").slice(-800)}|`;

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        max_tokens: 60,
        temperature: 0.3,
        stream: false,
      },
      { signal: request.signal }
    );

    const result =
      completion.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ result: "" }, { status: 200 });
    }
    return NextResponse.json({ result: "" }, { status: 200 });
  }
}

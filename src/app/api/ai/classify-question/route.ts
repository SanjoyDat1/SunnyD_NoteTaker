import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";

/**
 * Classify if a sentence is a genuine question to answer or rhetorical/conversational.
 * Model: gpt-4o-mini | max_tokens: 5 | temperature: 0
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ classification: "SKIP" }, { status: 200 });
    }

    const body = await request.json();
    const { sentence = "" } = body;

    if (typeof sentence !== "string" || !sentence.trim()) {
      return NextResponse.json({ classification: "SKIP" }, { status: 200 });
    }

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `Is this a genuine question someone wants answered, or is it rhetorical/conversational?
Return only: ANSWER or SKIP`,
          },
          {
            role: "user",
            content: `Sentence: "${sentence.slice(0, 500)}"`,
          },
        ],
        max_tokens: 5,
        temperature: 0,
      },
      { signal: request.signal }
    );

    const raw =
      completion.choices[0]?.message?.content?.trim().toUpperCase() ?? "";
    const classification = raw.includes("ANSWER") ? "ANSWER" : "SKIP";

    return NextResponse.json({ classification });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ classification: "SKIP" }, { status: 200 });
    }
    console.error("[api/ai/classify-question]", err);
    return NextResponse.json({ classification: "SKIP" }, { status: 200 });
  }
}

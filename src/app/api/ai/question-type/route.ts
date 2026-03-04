import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { questionTypePrompt } from "@/lib/prompts";

const TYPES = ["FACTUAL", "OPINION", "CLARIFICATION", "RHETORICAL"];

/**
 * Classify question type for contextual answer.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ type: "FACTUAL" }, { status: 200 });
    }

    const body = await request.json();
    const { question = "" } = body;

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: questionTypePrompt() },
          { role: "user", content: question },
        ],
        max_tokens: 15,
        temperature: 0.1,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw =
      completion.choices[0]?.message?.content?.trim()?.toUpperCase() ?? "";
    const type = TYPES.find((t) => raw.startsWith(t)) ?? "FACTUAL";

    return NextResponse.json({ type }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ type: "FACTUAL" }, { status: 200 });
    }
    return NextResponse.json({ type: "FACTUAL" }, { status: 200 });
  }
}

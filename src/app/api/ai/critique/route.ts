import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { selfCritiquePrompt } from "@/lib/prompts";

const MIN_WORDS_FOR_CRITIQUE = 15;

/**
 * Self-critique step for insertions >15 words.
 * Uses gpt-4o-mini — fast and cheap.
 * Returns original text if it passes (score >= 21/30), empty string otherwise.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ result: "" }, { status: 200 });
    }

    const body = await request.json();
    const { generated = "" } = body;

    const wordCount = generated.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_FOR_CRITIQUE) {
      return NextResponse.json({ result: generated }, { status: 200 });
    }

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: selfCritiquePrompt(generated) },
          { role: "user", content: "Score and return." },
        ],
        max_tokens: 500,
        temperature: 0,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? "";
    const passes = !/^EMPTY\s*$/i.test(raw);
    const result = passes ? generated : "";

    return NextResponse.json({ result }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ result: "" }, { status: 200 });
    }
    return NextResponse.json({ result: "" }, { status: 200 });
  }
}

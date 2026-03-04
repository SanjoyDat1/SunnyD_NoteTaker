import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { answerQuestionMiniPrompt } from "@/lib/prompts";

/**
 * Question answering endpoint.
 * Classification + answer in one call. Returns plain text (empty for RHETORICAL).
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ answer: "" }, { status: 200 });
    }

    const body = await request.json();
    const {
      questionText,
      docContext = "",
      noteType = "GENERAL",
    } = body;

    if (typeof questionText !== "string" || !questionText.trim()) {
      return NextResponse.json(
        { error: "questionText is required" },
        { status: 400 }
      );
    }

    const fingerprint = extractStyleFingerprintFromText(docContext);
    const systemPrompt = answerQuestionSystemPrompt(
      questionText,
      docContext,
      noteType,
      fingerprint
    );

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `Question: ${questionText}\nNote context: ${docContext.slice(0, 1200)}\nNote type: ${noteType}`,
          },
        ],
        max_tokens: 80,
        temperature: 0.4,
      },
      { signal: request.signal }
    );

    const answer =
      completion.choices[0]?.message?.content?.trim() ?? "";

    return NextResponse.json({ answer });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ answer: "" }, { status: 200 });
    }
    console.error("[api/ai/answer-question]", err);
    return NextResponse.json({ answer: "" }, { status: 200 });
  }
}

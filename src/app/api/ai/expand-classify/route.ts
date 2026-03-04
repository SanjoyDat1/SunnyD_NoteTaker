import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { expandClassifyPrompt } from "@/lib/prompts";

const VALID_LABELS = [
  "EXAMPLE",
  "EVIDENCE",
  "STEPS",
  "CONTEXT",
  "CONSEQUENCE",
] as const;

/**
 * Classify what kind of expansion would best improve the selection.
 * Returns { classification: "EXAMPLE" | "EVIDENCE" | ... }
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ classification: "CONTEXT" }, { status: 200 });
    }

    const body = await request.json();
    const { selectedText = "", noteType = "GENERAL" } = body;

    if (!selectedText.trim()) {
      return NextResponse.json({ classification: "CONTEXT" }, { status: 200 });
    }

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: expandClassifyPrompt(selectedText, noteType),
          },
        ],
        max_tokens: 15,
        temperature: 0.1,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw =
      completion.choices[0]?.message?.content?.trim()?.toUpperCase() ?? "";
    const classification =
      VALID_LABELS.find((l) => raw.startsWith(l)) ?? "CONTEXT";

    return NextResponse.json({ classification }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ classification: "CONTEXT" }, { status: 200 });
    }
    return NextResponse.json({ classification: "CONTEXT" }, { status: 200 });
  }
}

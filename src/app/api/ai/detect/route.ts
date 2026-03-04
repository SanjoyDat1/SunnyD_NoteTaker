import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { detectNoteTypeSystemPrompt } from "@/lib/prompts";

const VALID_TYPES = [
  "MEETING",
  "STUDY",
  "BRAINSTORM",
  "JOURNAL",
  "TECHNICAL",
  "PLANNING",
  "GENERAL",
] as const;

/**
 * Note type classification endpoint.
 * Model: gpt-4o-mini, non-streaming, max 10 tokens.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ noteType: "GENERAL" }, { status: 200 });
    }

    const body = await request.json();
    const { documentText } = body;

    if (typeof documentText !== "string") {
      return NextResponse.json(
        { error: "documentText is required" },
        { status: 400 }
      );
    }

    const truncated =
      documentText.length > 800
        ? documentText.slice(0, 800)
        : documentText;

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: detectNoteTypeSystemPrompt() },
          {
            role: "user",
            content: `Classify these notes:\n\n${truncated}`,
          },
        ],
        max_tokens: 10,
        temperature: 0,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw =
      completion.choices[0]?.message?.content?.trim().toUpperCase() ?? "GENERAL";
    const matched = VALID_TYPES.find((t) => raw === t || raw.includes(t));
    const noteType = matched ?? "GENERAL";

    return NextResponse.json({ noteType }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ noteType: "GENERAL" }, { status: 200 });
    }
    return NextResponse.json({ noteType: "GENERAL" }, { status: 200 });
  }
}

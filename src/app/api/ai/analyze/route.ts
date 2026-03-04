import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { analysisSystemPrompt } from "@/lib/prompts";
import { extractStyleFingerprintFromText } from "@/lib/context";

export interface AnalyzeInsight {
  anchorText: string;
  type: "suggestion" | "gap" | "action" | "question";
  insight: string;
}

/**
 * Document analysis / gap detection endpoint.
 * Model: gpt-4o-mini, non-streaming, max 300 tokens.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ insights: [] }, { status: 200 });
    }

    const body = await request.json();
    const { documentText, noteType = "GENERAL" } = body;

    if (typeof documentText !== "string") {
      return NextResponse.json(
        { error: "documentText is required" },
        { status: 400 }
      );
    }

    const truncated =
      documentText.length > 2000
        ? documentText.slice(0, 500) + "\n...\n" + documentText.slice(-500)
        : documentText;

    const fingerprint = extractStyleFingerprintFromText(documentText);

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: analysisSystemPrompt(noteType, fingerprint) },
          {
            role: "user",
            content: `Analyze these notes:\n\n${truncated}`,
          },
        ],
        max_tokens: 400,
        temperature: 0.3,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";

    let insights: AnalyzeInsight[] = [];
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        insights = parsed.filter(
          (item: unknown): item is AnalyzeInsight =>
            typeof item === "object" &&
            item !== null &&
            "anchorText" in item &&
            "type" in item &&
            "insight" in item
        );
      }
    } catch {
      insights = [];
    }

    return NextResponse.json({ insights }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ insights: [] }, { status: 200 });
    }
    return NextResponse.json({ insights: [] }, { status: 200 });
  }
}

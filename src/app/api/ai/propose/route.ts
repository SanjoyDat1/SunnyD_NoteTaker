import { NextRequest, NextResponse } from "next/server";
import openai from "@/lib/openai";
import { proposeSystemPrompt } from "@/lib/prompts";
import { extractStyleFingerprintFromText } from "@/lib/context";

export interface Proposal {
  targetText: string;
  action:
    | "INSERT_AFTER"
    | "REPLACE"
    | "APPEND_EXAMPLE"
    | "ADD_CONTEXT"
    | "COMPLETE_THOUGHT"
    | "FLAG_CONTRADICTION"
    | "EXTRACT_ACTION";
  preview: string;
  label: string;
}

/**
 * Document-wide proposals. SunnyD acts anywhere in the document.
 * Model: gpt-4o, no stream, max 600 tokens.
 */
export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ proposals: [] }, { status: 200 });
    }

    const body = await request.json();
    const { fullDocumentText = "", noteType = "GENERAL" } = body;

    const truncated =
      fullDocumentText.length > 4000
        ? fullDocumentText.slice(0, 2000) +
          "\n...\n" +
          fullDocumentText.slice(-2000)
        : fullDocumentText;

    const fingerprint = extractStyleFingerprintFromText(fullDocumentText);

    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          { role: "system", content: proposeSystemPrompt(noteType, fingerprint) },
          {
            role: "user",
            content: `Analyze and propose improvements:\n\n${truncated}`,
          },
        ],
        max_tokens: 600,
        temperature: 0.3,
        stream: false,
      },
      { signal: request.signal }
    );

    const raw = completion.choices[0]?.message?.content?.trim() ?? "[]";
    let proposals: Proposal[] = [];

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        proposals = parsed
          .filter(
            (p: unknown): p is Proposal =>
              typeof p === "object" &&
              p !== null &&
              "targetText" in p &&
              "action" in p &&
              "preview" in p &&
              "label" in p
          )
          .slice(0, 3);
      }
    } catch {
      proposals = [];
    }

    return NextResponse.json({ proposals }, { status: 200 });
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return NextResponse.json({ proposals: [] }, { status: 200 });
    }
    return NextResponse.json({ proposals: [] }, { status: 200 });
  }
}
